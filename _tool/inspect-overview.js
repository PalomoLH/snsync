const fs = require('fs');

['Default_status_report', 'One_page_status_report'].forEach(name => {
	console.log('\n=== ' + name + ' ===');
	const data = JSON.parse(fs.readFileSync(
		'E:/workspace/4matt/snsync/projects/demo1/src/sn_doc_page_template/' + name + '/content_json.json', 'utf8'));

	data.editorData.content.forEach((block, bi) => {
		(block.content || []).forEach(node => {
			if (node.type !== 'table') return;
			const s = JSON.stringify(node.content);
			if (!s.includes('"text":"Planned start"') && !s.includes('start_date') && !s.includes('percent_complete')) return;

			console.log('\nOVERVIEW TABLE [block ' + bi + '] — ' + node.content.length + ' rows');
			node.content.forEach((row, ri) => {
				console.log('  row ' + ri + ' (' + row.content.length + ' cells):');
				row.content.forEach((cell, ci) => {
					const cs = JSON.stringify(cell);
					const token = (cs.match(/"type":"template_token".*?"fieldPath":"([^"]+)"/) || [])[1];
					const texts = (cs.match(/"text":"([^"]+)"/g) || []).map(t => t.slice(8,-1));
					const hasStrong = cs.includes('"type":"strong"');
					console.log('    cell ' + ci + ': ' + (token ? 'TOKEN:' + token : 'TEXT:[' + texts.join('|') + ']' + (hasStrong?' (strong)':'')));
				});
			});
		});
	});
});
