const fs = require('fs');

const data = JSON.parse(fs.readFileSync(
	'E:/workspace/4matt/snsync/projects/demo1/src/sn_doc_page_template/Default_status_report/content_json.json', 'utf8'));

function findTokens(obj, path) {
	if (!obj || typeof obj !== 'object') return;
	if (obj.type === 'template_token') {
		console.log('  TOKEN at ' + path + ': ' + JSON.stringify(obj.attrs));
		return;
	}
	if (Array.isArray(obj)) {
		obj.forEach((item, i) => findTokens(item, path + '[' + i + ']'));
	} else {
		Object.keys(obj).forEach(k => findTokens(obj[k], path + '.' + k));
	}
}

// Find overview block (has percent_complete OR start_date related fields)
data.editorData.content.forEach((block, bi) => {
	(block.content || []).forEach(node => {
		if (node.type !== 'table') return;
		const s = JSON.stringify(node.content);
		if (!s.includes('percent_complete')) return;
		console.log('=== BLOCK ' + bi + ' (Overview table) ===');
		findTokens(node, 'block' + bi);
	});
});

// Also find Risks table for fieldPath reference
data.editorData.content.forEach((block, bi) => {
	(block.content || []).forEach(node => {
		if (node.type !== 'table') return;
		const s = JSON.stringify(node.content);
		if (!s.includes('mitigation')) return;
		console.log('=== BLOCK ' + bi + ' (Risks table) ===');
		findTokens(node, 'block' + bi);
	});
});
