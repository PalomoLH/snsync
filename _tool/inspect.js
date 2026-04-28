const fs = require('fs');

['Default_status_report', 'One_page_status_report'].forEach(name => {
	console.log('\n=== ' + name + ' ===');
	const data = JSON.parse(fs.readFileSync(
		'E:/workspace/4matt/snsync/projects/demo1/src/sn_doc_page_template/' + name + '/content_json.json', 'utf8'));

	data.editorData.content.forEach((block, bi) => {
		(block.content || []).forEach(node => {
			if (node.type !== 'table') return;
			const s = JSON.stringify(node.content);
			const label =
				s.includes('project_key_milestone') ? 'Key Milestones' :
				s.includes('risk_baseline') ? 'Risks' :
				s.includes('issue_baseline') ? 'Issues' :
				s.includes('sys_created_by') ? 'Header table' :
				s.includes('start_date') ? 'Overview' : 'Other';
			console.log('\nTABLE [block ' + bi + ']: ' + label);
			node.content.forEach((row, ri) => {
				console.log('  row ' + ri + ':');
				row.content.forEach((cell, ci) => {
					const cs = JSON.stringify(cell);
					const tokenMatch = cs.match(/"fieldPath":"([^"]+)"/);
					const textMatches = cs.match(/"text":"([^"]+)"/g) || [];
					const texts = textMatches.map(t => t.replace(/"text":"/, '').replace(/"$/, '')).join(' | ');
					console.log('    cell ' + ci + ': ' + (tokenMatch ? 'TOKEN:' + tokenMatch[1] : 'TEXT:' + texts));
				});
			});
		});
	});
});
