const fs = require('fs');

function processTemplate(filePath) {
	const raw = fs.readFileSync(filePath, 'utf8');
	const data = JSON.parse(raw);

	data.editorData.content.forEach((block, bi) => {
		(block.content || []).forEach(node => {
			if (node.type !== 'table') return;
			const s = JSON.stringify(node.content);

			// FIX 1: Header table — remove body cell "Default status report" / "One page status report"
			if (s.includes('"fieldPath":"sys_created_by"')) {
				node.content = node.content.map(row => ({
					...row,
					content: row.content.filter(cell => {
						const cs = JSON.stringify(cell);
						// drop plain-text cells that are NOT a template_token and NOT a strong header
						const hasToken  = cs.includes('"type":"template_token"');
						const hasStrong = cs.includes('"type":"strong"');
						return hasToken || hasStrong;
					})
				}));
				console.log('  [block ' + bi + '] Header table: removed leftover template name cell');
			}

			// FIX 2: Overview last row — "Planned start" / "Planned end" headers have no tokens in data row
			if (s.includes('"text":"Planned start"') && !s.includes('"fieldPath":"start_date"')) {
				node.content = node.content.map(row => {
					const rs = JSON.stringify(row);
					if (!rs.includes('"text":"Planned start"') && !rs.includes('"text":"Planned end"')) return row;
					// This is the header row — it's fine, keep it
					if (rs.includes('"type":"strong"')) return row;
					// This is the empty data row — replace with tokens
					return {
						...row,
						content: [
							makeTokenCell('project_status', 'start_date', 'Planned start date'),
							makeTokenCell('project_status', 'end_date', 'Planned end date')
						]
					};
				});
				console.log('  [block ' + bi + '] Overview: fixed empty Planned start/end data cells');
			}
		});
	});

	fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
	console.log('Saved: ' + filePath);
}

function makeTokenCell(table, fieldPath, displayValue) {
	return {
		type: 'table_cell',
		attrs: { colspan: 1, rowspan: 1, colwidth: null, background: null },
		content: [{
			type: 'paragraph',
			attrs: { textAlign: 'left', indent: '0px', associatedRecordField: {} },
			content: [{ type: 'template_token', attrs: { table, fieldPath, queryFilter: '', displayValue } }]
		}]
	};
}

const base = 'E:/workspace/4matt/snsync/projects/demo1/src/sn_doc_page_template/';
processTemplate(base + 'Default_status_report/content_json.json');
processTemplate(base + 'One_page_status_report/content_json.json');
