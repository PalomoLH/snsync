const fs = require('fs');

function processTemplate(filePath) {
	const raw = fs.readFileSync(filePath, 'utf8');
	const data = JSON.parse(raw);

	data.editorData.content.forEach((block, bi) => {
		(block.content || []).forEach(node => {
			if (node.type !== 'table') return;
			const s = JSON.stringify(node.content);
			if (!s.includes('percent_complete')) return;

			node.content.forEach((row, ri) => {
				const rs = JSON.stringify(row);
				if (!rs.includes('"text":"Planned start"') && !rs.includes('"text":"Planned end"')) return;
				if (!rs.includes('"type":"strong"')) return;

				row.content.forEach((cell, ci) => {
					const cs = JSON.stringify(cell);
					const hasToken = cs.includes('"type":"template_token"');
					if (hasToken) return;

					const isStartCell = cs.includes('"text":"Planned start"');
					const isEndCell   = cs.includes('"text":"Planned end"');
					if (!isStartCell && !isEndCell) return;

					const fieldPath    = isStartCell ? 'project.start_date'  : 'project.end_date';
					const displayValue = isStartCell ? 'Project/Start date'   : 'Project/End date';

					const para = cell.content[0];
					para.content.push({ type: 'text', text: '   ' });
					para.content.push({
						type: 'template_token',
						attrs: {
							table: 'project_status',
							fieldPath,
							queryFilter: '',
							displayValue
						}
					});
					console.log('  [block ' + bi + ' row ' + ri + ' cell ' + ci + '] added token: ' + fieldPath);
				});
			});
		});
	});

	fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
	console.log('Saved: ' + filePath);
}

const base = 'E:/workspace/4matt/snsync/projects/demo1/src/sn_doc_page_template/';
processTemplate(base + 'Default_status_report/content_json.json');
processTemplate(base + 'One_page_status_report/content_json.json');
