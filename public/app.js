const usersEl=document.querySelector('#users');const emptyEl=document.querySelector('#empty');const dialog=document.querySelector('#dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dt=v=>v?new Intl.DateTimeFormat('ja-JP',{dateStyle:'short',timeStyle:'medium'}).format(new Date(v)):'-';
async function load(){
    try{const [users,logs]=await Promise.all([fetch('/api/users').then(r=>r.json()),fetch('/api/logs').then(r=>r.json())]);
    
        document.querySelector('#status').textContent='オンライン';
        document.querySelector('#status').className='status ok';
        document.querySelector('#count').textContent=users.length;
        document.querySelector('#lastSync').textContent=logs[0]?dt(logs[0].occurred_at):'-';emptyEl.hidden=users.length>0;
        usersEl.innerHTML=users.map(
            (u,i)=>`<tr>
            <td><strong>${esc(u.display_name||u.user_name)}</strong></td>
            <td>${esc(u.user_name)}</td>
            <td class="mono">${esc(u.external_id)}</td>
            <td>${esc(u.payload.attribute || '-')}</td>
            <td><span class="pill ${u.active?'active':'inactive'}">${u.active?'有効':'無効'}</span></td>
            <td>${dt(u.updated_at)}</td>
            
            </tr>`
        ).join('');
    
        usersEl.querySelectorAll('.view').forEach(b=>b.onclick=()=>{document.querySelector('#json').textContent=JSON.stringify(users[Number(b.dataset.i)].payload,null,2);
        dialog.showModal()});
        document.querySelector('#logs').innerHTML=logs.length?logs.map(
            l=>`<div class="log"><span class="method">${esc(l.method)}</span>
            <span>${esc(l.result)} <span class="mono">${esc(l.external_id||'')}</span></span>
            <time>${dt(l.occurred_at)}</time></div>`).join(''):'<div class="empty">処理履歴はありません。</div>';}      
    catch(e){document.querySelector('#status').textContent='接続エラー';
        document.querySelector('#status').className='status ng';}}
        
document.querySelector('#reload').onclick=load;document.querySelector('#close').onclick=()=>dialog.close();load();setInterval(load,3000);
