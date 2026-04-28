const fs = require('fs');

const data = JSON.parse(fs.readFileSync(
	'E:/workspace/4matt/snsync/projects/demo1/src/sn_doc_page_template/Default_status_report/content_json.json', 'utf8'));

data.editorData.content.forEach((block, bi) => {
	(block.content || []).forEach(node => {
		if (node.type !== 'table') return;
		const s = JSON.stringify(node.content);
		if (!s.includes('percent_complete')) return;

		// print row 2 cell 0 (percent_complete) — simple overview cell
		const cell = node.content[2].content[0];
		console.log('=== percent_complete cell (overview row 2) ===');
		console.log(JSON.stringify(cell, null, 2));

		// print row 3 cell 0 (Planned start header)
		const headerCell = node.content[3].content[0];
		console.log('\n=== Planned start header cell (overview row 3, cell 0) ===');
		console.log(JSON.stringify(headerCell, null, 2));
	});
});
