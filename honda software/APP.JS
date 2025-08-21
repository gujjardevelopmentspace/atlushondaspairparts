// SPA Agent — all logic in one AppAgent class (localStorage-based)
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];
const uid = (p='') => p + Math.random().toString(36).slice(2,9);
const fmt = n => Number(n||0).toLocaleString();

class Store {
  static get(key, fallback){ try{ return JSON.parse(localStorage.getItem(key)) ?? fallback }catch{ return fallback } }
  static set(key, val){ localStorage.setItem(key, JSON.stringify(val)) }
  static backup(){ const blob = new Blob([JSON.stringify(localStorage,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='agent_backup.json'; a.click() }
  static async restore(file){ const text = await file.text(); const data = JSON.parse(text); localStorage.clear(); for(const [k,v] of Object.entries(data)) localStorage.setItem(k, typeof v==='string'?v:JSON.stringify(v)); location.reload(); }
}

class AppAgent{
  constructor(root){
    this.root = root;
    this.state = { view:'dashboard', filter:'' };
    this.db = {
      items: Store.get('items', []),
      invoices: Store.get('invoices', []),
      services: Store.get('services', []),
      returns: Store.get('returns', []),
      customers: Store.get('customers', [])
    };
    this.routes = {
      dashboard: ()=>this.renderDashboard(),
      inventory: ()=>this.renderInventory(),
      billing: ()=>this.renderBilling(),
      returns: ()=>this.renderReturns(),
      workshop: ()=>this.renderWorkshop(),
      reports: ()=>this.renderReports(),
    };
    this.ensureSeed();
    this.bindGlobal();
    this.go('dashboard');
  }

  ensureSeed(){
    if(this.db.items.length) return;
    const sample = [
      {id:uid('itm_'), name:'Engine Oil 20W-50', code:'AH-EO-2050', qty:35, low:8, buy:800, sell:1200, supplier:'Atlas Honda', desc:'Genuine oil for 125cc'},
      {id:uid('itm_'), name:'Brake Shoe Set', code:'AH-BS-125', qty:20, low:5, buy:600, sell:950, supplier:'Atlas Honda', desc:'Front/Rear compatible'},
      {id:uid('itm_'), name:'Spark Plug', code:'AH-SP-PZ', qty:55, low:10, buy:250, sell:450, supplier:'NGK', desc:'PZ type'},
      {id:uid('itm_'), name:'Air Filter', code:'AH-AF-125', qty:18, low:5, buy:300, sell:520, supplier:'Atlas Honda', desc:'Genuine'}
    ];
    const inv = [{
      id: uid('inv_'), ts: Date.now()-86400000, cust:'Walk-in', items:[
        {ref:sample[0].id, name:sample[0].name, code:sample[0].code, qty:2, price:1200, type:'part'},
        {ref:sample[2].id, name:sample[2].name, code:sample[2].code, qty:1, price:450, type:'part'},
        {name:'Oil Change Service', qty:1, price:500, type:'service'}
      ], subtotal: 3350, discount: 0, tax: 0, total: 3350
    }];
    this.db.items = sample;
    this.db.invoices = inv;
    this.persist();
  }

  persist(){ for(const k of Object.keys(this.db)) Store.set(k, this.db[k]); }

  // --- Router
  go(view){ this.state.view=view; $('#view').innerHTML = ''; $$('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===view)); this.routes[view](); }

  // --- Utilities
  toast(msg){ const el=document.createElement('div'); el.className='toast'; el.textContent=msg; $('#toast').appendChild(el); setTimeout(()=>el.remove(), 3000); }
  findItemByCode(code){ return this.db.items.find(i=>i.code.toLowerCase()===code.toLowerCase()); }
  updateKpis(){
    const sales = this.db.invoices.reduce((a,x)=>a+x.total,0);
    const svc = this.db.invoices.reduce((a,x)=>a+x.items.filter(i=>i.type==='service').reduce((s,y)=>s+y.qty*y.price,0),0);
    const stock = this.db.items.reduce((a,x)=>a+x.qty,0);
    return { sales, services:svc, stock };
  }

  // --- Dashboard
  renderDashboard(){
    const low = this.db.items.filter(i=>i.qty<= (i.low??5));
    const k = this.updateKpis();
    $('#view').innerHTML = `
      <div class="cards">
        <div class="card"><div class="title">Total Sales</div><div class="value">Rs ${fmt(k.sales)}</div></div>
        <div class="card"><div class="title">Total Services</div><div class="value">Rs ${fmt(k.services)}</div></div>
        <div class="card"><div class="title">Stock Count</div><div class="value">${fmt(k.stock)}</div></div>
        <div class="card warn"><div class="title">Low Stock Alerts</div><div class="value">${low.length} items</div></div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 8px">Today Activity</h3>
        <div class="grid3">
          <div class="kpi"><span class="badge">Invoices</span> <b>${this.db.invoices.length}</b></div>
          <div class="kpi"><span class="badge">Returns</span> <b>${this.db.returns.length}</b></div>
          <div class="kpi"><span class="badge">Items</span> <b>${this.db.items.length}</b></div>
        </div>
        <canvas id="dashChart" height="120" style="margin-top:10px"></canvas>
      </div>
    `;
    // Simple chart: parts vs services revenue
    const partsRev = this.db.invoices.reduce((a,inv)=>a+inv.items.filter(i=>i.type!=='service').reduce((s,x)=>s+x.qty*x.price,0),0);
    const svcRev = this.db.invoices.reduce((a,inv)=>a+inv.items.filter(i=>i.type==='service').reduce((s,x)=>s+x.qty*x.price,0),0);
    new Chart($('#dashChart'), { type:'doughnut', data:{ labels:['Spare Parts','Workshop'], datasets:[{ data:[partsRev, svcRev] }] } });
  }

  // --- Inventory
  renderInventory(){
    const q = (this.state.filter||'').toLowerCase();
    const rows = this.db.items.filter(i=>[i.name,i.code,i.supplier].join(' ').toLowerCase().includes(q)).map(i=>`
      <tr>
        <td>${i.name}<div class="badge">${i.code}</div></td>
        <td>${i.qty} ${i.qty <= (i.low??5) ? '<span class="badge" style="border-color:#4b2;">LOW</span>':''}</td>
        <td>Rs ${fmt(i.buy)}</td>
        <td>Rs ${fmt(i.sell)}</td>
        <td>${i.supplier||'-'}</td>
        <td>
          <button class="ghost" data-act="qr" data-id="${i.id}">QR</button>
          <button class="ghost" data-act="edit" data-id="${i.id}">Edit</button>
          <button class="ghost" data-act="del" data-id="${i.id}">Del</button>
        </td>
      </tr>
    `).join('');
    $('#view').innerHTML = `
      <div class="actions">
        <button class="primary" id="addItemBtn">+ Add Item</button>
        <button class="ghost" id="scanBtn">Scan QR</button>
        <button class="ghost" id="exportInv">Export Excel</button>
      </div>
      <div class="card">
        <table class="table">
          <thead><tr><th>Item</th><th>Qty</th><th>Purchase</th><th>Selling</th><th>Supplier</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No items</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card">
        <h3 style="margin-top:0">QR Preview</h3>
        <div class="qr" id="qrBox">QR</div>
      </div>
      <div id="qrScanner" class="card" style="display:none">
        <h3 style="margin-top:0">QR Scanner</h3>
        <div id="reader" style="width:260px"></div>
        <button class="ghost" id="stopScan">Stop</button>
      </div>
    `;
    $('#addItemBtn').onclick = ()=> this.openItemModal();
    $('#exportInv').onclick = ()=> this.exportInventory();
    $('#scanBtn').onclick = ()=> this.startScanner();
    $('#stopScan')?.addEventListener('click', ()=> this.stopScanner());
    $$('#view [data-act]').forEach(btn=>btn.onclick = (e)=>this.inventoryAction(e.currentTarget));
  }

  openItemModal(item=null){
    const dlg = $('#itemModal'); const form = $('#itemForm'); $('#itemModalTitle').textContent = item? 'Edit Item' : 'Add Item';
    form.reset();
    if(item){ form.name.value=item.name; form.code.value=item.code; form.qty.value=item.qty; form.low.value=item.low??5; form.buy.value=item.buy; form.sell.value=item.sell; form.supplier.value=item.supplier||''; form.desc.value=item.desc||''; }
    dlg.showModal();
    dlg.onclose = ()=>{
      if(dlg.returnValue!=='ok') return;
      const data = Object.fromEntries(new FormData(form).entries());
      const payload = { id: item?.id || uid('itm_'), name:data.name, code:data.code, qty:+data.qty, low:+data.low||5, buy:+data.buy, sell:+data.sell, supplier:data.supplier, desc:data.desc };
      if(item){
        Object.assign(this.db.items.find(x=>x.id===item.id), payload);
        this.toast('Item updated');
      }else{
        if(this.db.items.some(i=>i.code===payload.code)) return this.toast('Code already exists');
        this.db.items.push(payload); this.toast('Item added');
      }
      this.persist(); this.renderInventory();
    }
  }

  inventoryAction(btn){
    const id = btn.dataset.id; const item = this.db.items.find(i=>i.id===id);
    if(btn.dataset.act==='edit') return this.openItemModal(item);
    if(btn.dataset.act==='del'){ this.db.items = this.db.items.filter(i=>i.id!==id); this.persist(); this.toast('Deleted'); return this.renderInventory(); }
    if(btn.dataset.act==='qr'){ const box = $('#qrBox'); box.innerHTML=''; new QRCode(box, {text:item.code, width:120, height:120}); }
  }

  startScanner(){
    $('#qrScanner').style.display='block';
    this.qr = new Html5Qrcode("reader");
    this.qr.start({ facingMode: "environment" }, { fps:10, qrbox:200 }, (decoded)=>{
      this.state.filter = decoded; this.renderInventory(); this.stopScanner(); this.toast('Scanned: '+decoded);
    });
  }
  stopScanner(){ try{ this.qr?.stop().then(()=>this.qr.clear()); }catch{} }

  exportInventory(){
    const ws = XLSX.utils.json_to_sheet(this.db.items);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "inventory.xlsx");
  }

  // --- Billing
  renderBilling(){
    $('#view').innerHTML = `
      <div class="card">
        <div class="grid3">
          <label>Scan/Code <input id="billCode" placeholder="Enter code or scan QR"/></label>
          <label>Search <input id="billSearch" placeholder="Type item name…"/></label>
          <label>Customer <input id="billCust" placeholder="Walk-in"/></label>
        </div>
        <div class="actions" style="margin-top:10px">
          <button class="ghost" id="billScan">Scan</button>
          <button class="ghost" id="addService">+ Service</button>
          <button class="primary" id="billSave">Generate Invoice</button>
        </div>
        <table class="table" id="billTable">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th></th></tr></thead>
          <tbody></tbody>
          <tfoot>
            <tr><td colspan="5">
              <div class="grid3">
                <label>Subtotal <input id="subTotal" readonly/></label>
                <label>Discount <input id="discount" type="number" min="0" step="0.01" value="0"/></label>
                <label>Tax <input id="tax" type="number" min="0" step="0.01" value="0"/></label>
              </div>
              <div style="margin-top:8px"><b>Grand Total: Rs <span id="grand">0</span></b></div>
            </td></tr>
          </tfoot>
        </table>
      </div>
    `;
    this.bill = [];
    const renderRows = ()=>{
      const tb = $('#billTable tbody'); tb.innerHTML = this.bill.map((r,i)=>`
        <tr>
          <td>${r.name}</td>
          <td><input data-i="${i}" data-k="qty" type="number" min="1" value="${r.qty}" style="width:70px"/></td>
          <td><input data-i="${i}" data-k="price" type="number" min="0" step="0.01" value="${r.price}" style="width:100px"/></td>
          <td>Rs ${fmt(r.qty*r.price)}</td>
          <td><button class="ghost" data-del="${i}">✕</button></td>
        </tr>
      `).join('');
      tb.querySelectorAll('input').forEach(inp=> inp.oninput = ()=>{ const i=+inp.dataset.i; const k=inp.dataset.k; this.bill[i][k]=+inp.value; updateTotals(); });
      tb.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=>{ this.bill.splice(+b.dataset.del,1); renderRows(); updateTotals(); });
      updateTotals();
    };
    const updateTotals = ()=>{
      const sub = this.bill.reduce((a,x)=>a+x.qty*x.price,0);
      $('#subTotal').value = sub.toFixed(2);
      const discount = +$('#discount').value||0;
      const tax = +$('#tax').value||0;
      $('#grand').textContent = fmt((sub - discount + tax));
    };
    $('#discount').oninput = $('#tax').oninput = updateTotals;

    const addItemByCode = code => {
      const item = this.findItemByCode(code) || this.db.items.find(i=>i.name.toLowerCase().includes(code.toLowerCase()));
      if(!item) return this.toast('Not found');
      this.bill.push({ref:item.id, type:'part', name:item.name, code:item.code, qty:1, price:item.sell});
      renderRows();
    };

    $('#billCode').addEventListener('keydown', e=>{ if(e.key==='Enter'){ addItemByCode(e.target.value.trim()); e.target.value=''; } });
    $('#billSearch').addEventListener('input', e=>{ const q=e.target.value.trim(); if(q.length>2) addItemByCode(q); });
    $('#billScan').onclick = ()=> { this.startScanner(); const t = setInterval(()=>{ if(this.state.filter){ addItemByCode(this.state.filter); this.state.filter=''; this.stopScanner(); clearInterval(t);} }, 400); };
    $('#addService').onclick = ()=>{ this.bill.push({type:'service', name:prompt('Service name','General Service')||'Service', qty:1, price:+prompt('Charge','500')||500}); renderRows(); };
    $('#billSave').onclick = ()=>{
      if(!this.bill.length) return this.toast('Empty bill');
      // Stock check
      for(const r of this.bill.filter(x=>x.type==='part')){
        const it = this.db.items.find(i=>i.id===r.ref);
        if(!it || it.qty<r.qty) return this.toast(`Insufficient stock for ${r?.name}`);
      }
      const sub = this.bill.reduce((a,x)=>a+x.qty*x.price,0);
      const inv = { id:uid('inv_'), ts:Date.now(), cust: $('#billCust').value || 'Walk-in', items: this.bill, subtotal: sub, discount:+$('#discount').value||0, tax:+$('#tax').value||0 };
      inv.total = sub - inv.discount + inv.tax;
      this.db.invoices.push(inv);
      // deduct stock
      for(const r of inv.items.filter(x=>x.type==='part')){
        const it = this.db.items.find(i=>i.id===r.ref); it.qty -= r.qty;
      }
      this.persist(); this.toast('Invoice '+inv.id+' saved'); this.printInvoice(inv); this.go('dashboard');
    };
  }

  printInvoice(inv){
    const w = window.open('','print');
    const rows = inv.items.map(i=>`<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.price}</td><td>${i.qty*i.price}</td></tr>`).join('');
    w.document.write(`
      <h2>Atlas Honda - Invoice ${inv.id}</h2>
      <div>Customer: ${inv.cust}</div><div>Date: ${new Date(inv.ts).toLocaleString()}</div>
      <table border="1" cellpadding="6" cellspacing="0"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>${rows}</table>
      <h3>Grand Total: Rs ${inv.total}</h3>
      <small>Thanks for your purchase!</small>
      <script>window.print();<\/script>
    `);
    w.document.close();
  }

  // --- Returns
  renderReturns(){
    $('#view').innerHTML = `
      <div class="card">
        <label>Find Invoice <input id="retInv" placeholder="Enter invoice ID"/></label>
        <div class="actions" style="margin-top:10px">
          <button class="primary" id="loadInv">Load</button>
        </div>
        <div id="retBox"></div>
      </div>
    `;
    $('#loadInv').onclick = ()=>{
      const id = $('#retInv').value.trim(); const inv = this.db.invoices.find(i=>i.id===id);
      if(!inv) return this.toast('Not found');
      $('#retBox').innerHTML = `
        <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Return</th></tr></thead>
        <tbody>
          ${inv.items.filter(i=>i.type==='part').map((i,idx)=>`
            <tr><td>${i.name}</td><td>${i.qty}</td><td><input type="number" min="0" max="${i.qty}" value="0" data-r="${idx}" style="width:90px"/></td></tr>
          `).join('')}
        </tbody></table>
        <button class="primary" id="doReturn">Process Return</button>
      `;
      $('#doReturn').onclick = ()=>{
        const retItems = [...$('#retBox').querySelectorAll('[data-r]')].map(inp=>({i:+inp.dataset.r, qty:+inp.value||0})).filter(x=>x.qty>0);
        if(!retItems.length) return this.toast('Nothing selected');
        const record = { id:uid('ret_'), ts:Date.now(), inv:id, items:[] };
        for(const {i,qty} of retItems){
          const line = inv.items[i];
          const it = this.db.items.find(x=>x.id===line.ref);
          if(it){ it.qty += qty; record.items.push({ref:it.id, name:it.name, qty}); }
        }
        this.db.returns.push(record); this.persist(); this.toast('Return processed. Credit note '+record.id); this.go('dashboard');
      };
    };
  }

  // --- Workshop
  renderWorkshop(){
    $('#view').innerHTML = `
      <div class="card">
        <div class="grid3">
          <label>Customer <input id="svcCust" placeholder="Customer name"/></label>
          <label>Service Type <input id="svcType" placeholder="e.g., Tuning"/></label>
          <label>Description <input id="svcDesc" placeholder="Notes"/></label>
        </div>
        <div class="actions" style="margin-top:10px">
          <button class="ghost" id="svcAddPart">+ Add Spare Part</button>
          <button class="primary" id="svcSave">Save Order</button>
        </div>
        <table class="table" id="svcTable">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    `;
    this.svcLines = [{type:'service', name:$('#svcType')?.value||'Service Charge', qty:1, price:500}];
    const render = ()=>{
      $('#svcTable tbody').innerHTML = this.svcLines.map((r,i)=>`
        <tr>
          <td>${r.name}</td>
          <td><input data-i="${i}" data-k="qty" type="number" min="1" value="${r.qty}" style="width:70px"/></td>
          <td><input data-i="${i}" data-k="price" type="number" min="0" step="0.01" value="${r.price}" style="width:100px"/></td>
          <td><button class="ghost" data-del="${i}">✕</button></td>
        </tr>
      `).join('');
      $('#svcTable tbody').querySelectorAll('input').forEach(inp=> inp.oninput = ()=>{ const i=+inp.dataset.i; const k=inp.dataset.k; this.svcLines[i][k]=+inp.value; });
      $('#svcTable tbody').querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=>{ this.svcLines.splice(+b.dataset.del,1); render(); });
    };
    render();
    $('#svcAddPart').onclick = ()=>{
      const code = prompt('Enter item code or name');
      if(!code) return;
      const it = this.findItemByCode(code) || this.db.items.find(i=>i.name.toLowerCase().includes(code.toLowerCase()));
      if(!it) return this.toast('Not found');
      this.svcLines.push({type:'part', ref:it.id, name:it.name, code:it.code, qty:1, price:it.sell}); render();
    };
    $('#svcSave').onclick = ()=>{
      const cust = $('#svcCust').value||'Walk-in', type=$('#svcType').value||'General Service', desc=$('#svcDesc').value||'';
      // Deduct stock for parts
      for(const r of this.svcLines.filter(x=>x.type==='part')){
        const it = this.db.items.find(i=>i.id===r.ref);
        if(!it || it.qty<r.qty) return this.toast('Insufficient: '+r.name);
      }
      for(const r of this.svcLines.filter(x=>x.type==='part')) this.db.items.find(i=>i.id===r.ref).qty -= r.qty;
      const total = this.svcLines.reduce((a,x)=>a+x.qty*x.price,0);
      const inv = { id:uid('inv_'), ts:Date.now(), cust, items:this.svcLines, subtotal:total, discount:0, tax:0, total };
      this.db.invoices.push(inv);
      this.db.services.push({ id:uid('svc_'), ts:Date.now(), cust, type, desc, lines:this.svcLines, total });
      this.persist(); this.toast('Service saved as invoice '+inv.id); this.go('dashboard');
    };
  }

  // --- Reports
  renderReports(){
    const days = (n)=> new Date(Date.now()-n*86400000).toDateString();
    const bucket = (period)=>{
      const data = {};
      for(const inv of this.db.invoices){
        const d = new Date(inv.ts); let key = d.toDateString();
        if(period==='weekly'){ const wk = Math.ceil((d.getDate())/7); key = `${d.getMonth()+1}/${wk}/${d.getFullYear()}`; }
        if(period==='monthly'){ key = `${d.getMonth()+1}/${d.getFullYear()}`; }
        data[key] = (data[key]||0) + inv.total;
      }
      return data;
    };
    $('#view').innerHTML = `
      <div class="actions">
        <select id="period">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly" selected>Monthly</option>
        </select>
        <button class="ghost" id="expPdf">Export PDF</button>
        <button class="ghost" id="expXlsx">Export Excel</button>
      </div>
      <div class="card"><canvas id="salesChart" height="140"></canvas></div>
      <div class="card">
        <h3 style="margin:0 0 8px">Top Selling</h3>
        <table class="table"><thead><tr><th>Name</th><th>Qty</th><th>Revenue</th></tr></thead><tbody id="topBody"></tbody></table>
      </div>
    `;
    const draw = ()=>{
      const period = $('#period').value;
      const data = bucket(period);
      if(this.salesChart) this.salesChart.destroy();
      this.salesChart = new Chart($('#salesChart'), { type:'bar', data:{ labels:Object.keys(data), datasets:[{ label:'Sales', data:Object.values(data) }] } });
      // top-selling
      const agg = {};
      for(const inv of this.db.invoices){
        for(const it of inv.items.filter(x=>x.type!=='service')){
          const k = it.name; if(!agg[k]) agg[k]={qty:0, rev:0};
          agg[k].qty += it.qty; agg[k].rev += it.qty*it.price;
        }
      }
      const top = Object.entries(agg).sort((a,b)=>b[1].qty-a[1].qty).slice(0,10);
      $('#topBody').innerHTML = top.map(([name, v])=>`<tr><td>${name}</td><td>${v.qty}</td><td>Rs ${fmt(v.rev)}</td></tr>`).join('') || '<tr><td colspan="3">No data</td></tr>';
    };
    draw();
    $('#period').onchange = draw;
    $('#expPdf').onclick = ()=>{
      const doc = new jspdf.jsPDF({unit:'pt'}); doc.text('Sales Report', 40, 40);
      doc.text('Generated: '+ new Date().toLocaleString(), 40, 60);
      doc.text('Totals: Rs '+ fmt(this.db.invoices.reduce((a,x)=>a+x.total,0)), 40, 80);
      doc.save('report.pdf');
    };
    $('#expXlsx').onclick = ()=>{
      const rows = this.db.invoices.map(i=>({id:i.id, date:new Date(i.ts).toLocaleString(), total:i.total}));
      const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Invoices"); XLSX.writeFile(wb, "report.xlsx");
    };
  }

  // --- Global bindings
  bindGlobal(){
    // Nav
    $$('#nav button').forEach(b=> b.onclick = ()=> this.go(b.dataset.view));
    // Global search
    $('#globalSearch').addEventListener('input', e=>{ this.state.filter = e.target.value; if(this.state.view==='inventory') this.renderInventory(); });
    // Backup/restore
    $('#backupBtn').onclick = ()=> Store.backup();
    $('#restoreBtn').onclick = ()=> $('#restoreFile').click();
    $('#restoreFile').onchange = e=> Store.restore(e.target.files[0]);
  }
}

window.addEventListener('DOMContentLoaded', ()=> new AppAgent($('#view')));
