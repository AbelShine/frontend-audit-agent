import http from 'node:http';

const port = 4178;
const items = [
  { id: 1, name: '消防通道检查', scene: '消防', owner: '张管理员' },
  { id: 2, name: '机房巡检', scene: '网络运行', owner: '李管理员' },
];

const server = http.createServer((request, response) => {
  if (request.url?.startsWith('/api/items')) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ success: true, result: items }));
    return;
  }
  if (request.url === '/api/assign' && request.method === 'POST') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ success: true, result: null }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});

server.listen(port, '127.0.0.1', () => console.log(`Demo ready: http://127.0.0.1:${port}/`));

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frontend Agent Demo</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#182033;font:15px system-ui}.shell{max-width:1080px;margin:40px auto;padding:0 24px}.hero{background:#172554;color:white;padding:28px;border-radius:16px}.panel{background:white;margin-top:20px;padding:22px;border-radius:14px;box-shadow:0 8px 30px #16204414}.toolbar{display:flex;gap:10px}input,select,button{height:38px;border:1px solid #cad3e3;border-radius:8px;padding:0 12px}input{flex:1}button{cursor:pointer;background:#2563eb;color:white;border:0}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;border-bottom:1px solid #e5eaf3;padding:12px}.modal{position:fixed;inset:0;background:#0006;display:none;align-items:center;justify-content:center}.modal.open{display:flex}.dialog{width:430px;background:white;border-radius:14px;padding:22px}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.secondary{background:#64748b}.toast{position:fixed;right:24px;top:24px;background:#059669;color:#fff;padding:12px 18px;border-radius:8px;display:none}
</style></head><body><main class="shell"><section class="hero"><h1>前端Agent操作型验证</h1><p>无需真实业务，演示查询、选择、弹窗、提交、提示次数和列表刷新。</p></section><section class="panel"><div class="toolbar"><input id="keyword" placeholder="输入任务名称"><button id="search">查询</button><button id="open">指派</button></div><table id="result-table"><thead><tr><th>选择</th><th>任务</th><th>场景</th><th>负责人</th></tr></thead><tbody></tbody></table></section></main><div id="modal" class="modal"><div class="dialog"><h2>指派专业管理员</h2><label>隐患场景<select id="scene"><option>消防</option><option>网络运行</option></select></label><div class="actions"><button id="cancel" class="secondary">取消</button><button id="submit">确认指派</button></div></div></div><div id="toast" class="toast">操作成功</div><script>
const tbody=document.querySelector('tbody');const modal=document.querySelector('#modal');const toast=document.querySelector('#toast');
async function load(){const keyword=document.querySelector('#keyword').value;const data=await fetch('/api/items?keyword='+encodeURIComponent(keyword)).then(r=>r.json());tbody.innerHTML=data.result.map(x=>'<tr><td><input type="checkbox" data-id="'+x.id+'"></td><td>'+x.name+'</td><td>'+x.scene+'</td><td>'+x.owner+'</td></tr>').join('')}
document.querySelector('#search').onclick=load;document.querySelector('#open').onclick=()=>modal.classList.add('open');document.querySelector('#cancel').onclick=()=>modal.classList.remove('open');document.querySelector('#submit').onclick=async()=>{await fetch('/api/assign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scene:document.querySelector('#scene').value})});modal.classList.remove('open');toast.style.display='block';setTimeout(()=>toast.style.display='none',800);await load()};load();
</script></body></html>`;
