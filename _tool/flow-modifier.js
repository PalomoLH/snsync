#!/usr/bin/env node
/**
 * ServiceNow Flow Designer Modifier
 * Single module to modify Flow Designer flows programmatically
 */

const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class FlowModifier {
    constructor(instance, token) {
        this.instance = instance.replace(/\/$/, ''); // Remove trailing slash
        this.token = token;
        this.api = axios.create({
            baseURL: `${this.instance}/api/now`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });
    }

    /**
     * Get flow XML from sys_update_xml table by flow sys_id
     */
    async getFlowXML(flowId) {
        try {
            const response = await this.api.get('/table/sys_update_xml', {
                params: {
                    sysparm_query: `name=sys_hub_flow_${flowId}`,
                    sysparm_fields: 'sys_id,name,payload,sys_updated_on,sys_updated_by'
                }
            });

            if (!response.data.result || response.data.result.length === 0) {
                throw new Error(`Flow not found: ${flowId}`);
            }

            return response.data.result[0];
        } catch (error) {
            throw new Error(`Failed to retrieve flow: ${error.message}`);
        }
    }

    /**
     * Decode base64+gzip action values to JSON
     */
    async decodeActionValues(encoded) {
        const buffer = Buffer.from(encoded, 'base64');
        const decompressed = await gunzip(buffer);
        return JSON.parse(decompressed.toString('utf8'));
    }

    /**
     * Encode JSON back to base64+gzip
     */
    async encodeActionValues(obj) {
        const json = JSON.stringify(obj);
        const compressed = await gzip(json, { level: 9 });
        return compressed.toString('base64');
    }

    /**
     * Find and extract action configuration from XML
     */
    findActionInXML(xml, actionId) {
        // More flexible pattern - allows any content between tags
        const pattern = new RegExp(
            `<sys_hub_action_instance_v2[^>]*>[\\s\\S]*?<sys_id>${actionId}</sys_id>[\\s\\S]*?<values>([\\s\\S]*?)</values>[\\s\\S]*?</sys_hub_action_instance_v2>`,
            ''
        );
        const match = xml.match(pattern);
        
        if (!match) {
            throw new Error(`Action not found in XML: ${actionId}`);
        }

        return {
            fullMatch: match[0],
            encodedValues: match[1].trim()
        };
    }

    /**
     * Replace action values in XML
     */
    replaceActionInXML(xml, actionId, newEncodedValues) {
        const pattern = new RegExp(
            `(<sys_hub_action_instance_v2[^>]*>[\\s\\S]*?<sys_id>${actionId}</sys_id>[\\s\\S]*?<values>)[\\s\\S]*?(</values>[\\s\\S]*?</sys_hub_action_instance_v2>)`,
            ''
        );
        
        return xml.replace(pattern, (match, before, after) => {
            return before + newEncodedValues + after;
        });
    }

    /**
     * Push modified flow XML back to ServiceNow
     */
    async pushFlowXML(updateSetId, payload) {
        try {
            const response = await this.api.put(`/table/sys_update_xml/${updateSetId}`, {
                payload: payload
            });

            return response.data.result;
        } catch (error) {
            throw new Error(`Failed to push flow: ${error.message}`);
        }
    }

    /**
     * Save flow data to disk (for review before pushing)
     */
    saveFlowToDisk(flowData, filepath) {
        const fs = require('fs');
        fs.writeFileSync(filepath, JSON.stringify(flowData, null, 2), 'utf8');
    }

    /**
     * Load flow data from disk
     */
    loadFlowFromDisk(filepath) {
        const fs = require('fs');
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }

    /**
     * Modify approval conditions (main operation)
     */
    async modifyApprovalConditions(flowId, actionId, newCondition = '', options = {}) {
        console.log('🔧 Flow Modifier - Approval Conditions');
        console.log('='.repeat(60));
        
        // Step 1: Get flow XML
        console.log(`📥 Retrieving flow: ${flowId}`);
        const flowData = await this.getFlowXML(flowId);
        console.log(`   Update Set Record: ${flowData.sys_id}`);
        console.log(`   Last Updated: ${flowData.sys_updated_on} by ${flowData.sys_updated_by}`);
        
        // Save original if requested
        if (options.saveOriginal) {
            console.log(`\n💾 Saving original flow to: ${options.saveOriginal}`);
            this.saveFlowToDisk(flowData, options.saveOriginal);
        }
        
        // Step 2: Find action in XML
        console.log(`\n🔍 Finding action: ${actionId}`);
        const actionMatch = this.findActionInXML(flowData.payload, actionId);
        
        // Step 3: Decode current configuration
        console.log('📖 Decoding action configuration...');
        const config = await this.decodeActionValues(actionMatch.encodedValues);
        const oldCondition = config.approval_conditions || '';
        console.log(`   Old condition: "${oldCondition}"`);
        console.log(`   New condition: "${newCondition}"`);
        
        // Step 4: Modify configuration
        config.approval_conditions = newCondition;
        
        // Step 5: Re-encode
        console.log('🔐 Encoding modified configuration...');
        const newEncodedValues = await this.encodeActionValues(config);
        
        // Step 6: Replace in XML
        console.log('📝 Updating XML payload...');
        const modifiedXML = this.replaceActionInXML(flowData.payload, actionId, newEncodedValues);
        
        // Create modified flow data
        const modifiedFlowData = {
            ...flowData,
            payload: modifiedXML
        };
        
        // Save modified version if requested
        if (options.saveModified) {
            console.log(`\n💾 Saving modified flow to: ${options.saveModified}`);
            this.saveFlowToDisk(modifiedFlowData, options.saveModified);
        }
        
        // Only push if explicitly requested
        if (options.push) {
            console.log('\n⬆️  Pushing to ServiceNow...');
            const result = await this.pushFlowXML(flowData.sys_id, modifiedXML);
            console.log('\n✅ SUCCESS: Flow modified and pushed');
            console.log(`   Updated: ${result.sys_updated_on}`);
            console.log(`   Updated by: ${result.sys_updated_by}`);
            return result;
        } else {
            console.log('\n✅ SUCCESS: Flow modified locally (not pushed)');
            console.log('\n📋 Summary:');
            console.log(`   Approval conditions: "${oldCondition}" → "${newCondition}"`);
            console.log('\nTo push this change, use: --push-flow');
            return modifiedFlowData;
        }
    }

    /**
     * Skip approval (set to auto-approve)
     */
    async skipApproval(flowId, actionId, options = {}) {
        return this.modifyApprovalConditions(flowId, actionId, '', options);
    }

    /**
     * Modify any action parameter
     */
    async modifyActionParameter(flowId, actionId, paramName, paramValue, options = {}) {
        console.log('🔧 Flow Modifier - Action Parameter');
        console.log('='.repeat(60));
        
        // Get flow XML
        console.log(`📥 Retrieving flow: ${flowId}`);
        const flowData = await this.getFlowXML(flowId);
        
        // Save original if requested
        if (options.saveOriginal) {
            console.log(`💾 Saving original flow to: ${options.saveOriginal}`);
            this.saveFlowToDisk(flowData, options.saveOriginal);
        }
        
        // Find action
        console.log(`🔍 Finding action: ${actionId}`);
        const actionMatch = this.findActionInXML(flowData.payload, actionId);
        
        // Decode
        console.log(`📖 Decoding configuration...`);
        const config = await this.decodeActionValues(actionMatch.encodedValues);
        const oldValue = config[paramName];
        
        console.log(`   Parameter: ${paramName}`);
        console.log(`   Old value: ${JSON.stringify(oldValue)}`);
        console.log(`   New value: ${JSON.stringify(paramValue)}`);
        
        // Modify
        config[paramName] = paramValue;
        
        // Re-encode and replace
        const newEncodedValues = await this.encodeActionValues(config);
        const modifiedXML = this.replaceActionInXML(flowData.payload, actionId, newEncodedValues);
        
        // Create modified flow data
        const modifiedFlowData = {
            ...flowData,
            payload: modifiedXML
        };
        
        // Save modified version if requested
        if (options.saveModified) {
            console.log(`\n💾 Saving modified flow to: ${options.saveModified}`);
            this.saveFlowToDisk(modifiedFlowData, options.saveModified);
        }
        
        // Only push if explicitly requested
        if (options.push) {
            console.log('\n⬆️  Pushing to ServiceNow...');
            const result = await this.pushFlowXML(flowData.sys_id, modifiedXML);
            console.log('\n✅ SUCCESS: Parameter modified and pushed');
            console.log(`   ${paramName}: ${JSON.stringify(oldValue)} → ${JSON.stringify(paramValue)}`);
            return result;
        } else {
            console.log('\n✅ SUCCESS: Parameter modified locally (not pushed)');
            console.log(`   ${paramName}: ${JSON.stringify(oldValue)} → ${JSON.stringify(paramValue)}`);
            console.log('\nTo push this change, use: --push-flow');
            return modifiedFlowData;
        }
    }

    /**
     * Validate flow XML structure
     */
    validateFlowXML(flowData) {
        console.log('🔍 Validating flow structure...');
        
        const errors = [];
        const warnings = [];
        
        // Check required fields
        if (!flowData.sys_id) errors.push('Missing sys_id');
        if (!flowData.name) errors.push('Missing name');
        if (!flowData.payload) errors.push('Missing payload');
        
        // Check XML structure
        if (flowData.payload) {
            if (!flowData.payload.includes('<sys_hub_flow>')) {
                errors.push('Invalid XML: missing <sys_hub_flow> root element');
            }
            
            // Count actions
            const actionMatches = flowData.payload.match(/<sys_hub_action_instance_v2[^>]*>/g);
            const actionCount = actionMatches ? actionMatches.length : 0;
            console.log(`   Found ${actionCount} action(s)`);
            
            if (actionCount === 0) {
                warnings.push('No actions found in flow');
            }
        }
        
        // Report results
        if (errors.length > 0) {
            console.log('\n❌ Validation FAILED:');
            errors.forEach(err => console.log(`   - ${err}`));
            return false;
        }
        
        if (warnings.length > 0) {
            console.log('\n⚠️  Warnings:');
            warnings.forEach(warn => console.log(`   - ${warn}`));
        }
        
        console.log('\n✅ Validation passed');
        return true;
    }

    /**
     * Push flow from local file
     */
    async pushFlowFromFile(filepath) {
        console.log('⬆️  Pushing flow from local file');
        console.log('='.repeat(60));
        
        // Load from disk
        console.log(`📂 Loading: ${filepath}`);
        const flowData = this.loadFlowFromDisk(filepath);
        
        // Validate first
        if (!this.validateFlowXML(flowData)) {
            throw new Error('Validation failed - cannot push invalid flow');
        }
        
        // Push to ServiceNow
        console.log(`\n⬆️  Pushing to ServiceNow...`);
        console.log(`   Update Set Record: ${flowData.sys_id}`);
        
        const result = await this.pushFlowXML(flowData.sys_id, flowData.payload);
        
        console.log('\n✅ SUCCESS: Flow pushed to ServiceNow');
        console.log(`   Updated: ${result.sys_updated_on}`);
        console.log(`   Updated by: ${result.sys_updated_by}`);
        
        return result;
    }

    /**
     * Get action configuration (read-only)
     */
    async getActionConfig(flowId, actionId) {
        const flowData = await this.getFlowXML(flowId);
        const actionMatch = this.findActionInXML(flowData.payload, actionId);
        return await this.decodeActionValues(actionMatch.encodedValues);
    }

    /**
     * List all actions in a flow
     */
    async listFlowActions(flowId) {
        const flowData = await this.getFlowXML(flowId);
        const xml = flowData.payload;
        
        // Extract all action instances
        const actionPattern = /<sys_hub_action_instance_v2[^>]*>[\s\S]*?<sys_id>(.*?)<\/sys_id>[\s\S]*?<ui_id>(.*?)<\/ui_id>[\s\S]*?<order>(.*?)<\/order>[\s\S]*?<action[^>]*>(.*?)<\/action>[\s\S]*?<\/sys_hub_action_instance_v2>/g;
        
        const actions = [];
        let match;
        while ((match = actionPattern.exec(xml)) !== null) {
            actions.push({
                sys_id: match[1],
                ui_id: match[2],
                order: parseInt(match[3]),
                action_ref: match[4]
            });
        }
        
        actions.sort((a, b) => a.order - b.order);
        return actions;
    }
}

module.exports = FlowModifier;
