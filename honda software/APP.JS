// ===== Utilities
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const uid = (p = '') => p + Math.random().toString(36).slice(2, 9);
const fmt = n => Number(n || 0).toLocaleString();

// ===== Storage helper
class Store {
  static get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  static set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  static backup() {
    const blob = new Blob([JSON.stringify(localStorage, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'agent_backup.json'; a.click();
  }
  static async restore(file) {
    const text = await file.text(); const data = JSON.parse(text);
    localStorage.clear(); for (const [k, v] of Object.entries(data)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    location.reload();
  }
}

// ===== CONFIG =====
const ADMIN_KEY = 'yahya123'; // <-- change this value if you want a different admin key

// ===== App
class AppAgent {
  constructor(root) {
    this.root = root;
    this.state = {
      view: 'dashboard',
      filter: '',
      role: Store.get('role', 'agent') || 'agent'
    };
    this.db = {
      items: Store.get('items', []),
      invoices: Store.get('invoices', []),
      services: Store.get('services', []),
      returns: Store.get('returns', []),
      customers: Store.get('customers', []),
      movements: Store.get('movements', [])
    };
    this.routes = {
      dashboard: () => this.renderDashboard(),
      inventory: () => this.renderInventory(),
      billing: () => this.renderBilling(),
      returns: () => this.renderReturns(),
      workshop: () => this.renderWorkshop(),
      reports: () => this.renderReports()
    };

    this.ensureSeed();
    this.bindGlobal();
    // apply role UI (hides/shows nav buttons) before routing
    this.applyRoleUI(this.state.role, { initial: true });
    this.go(this.state.view);
  }

  // ---- persistence
  persist() {
    for (const k of Object.keys(this.db)) Store.set(k, this.db[k]);
    Store.set('role', this.state.role);
  }

  // ---- seed sample data
  ensureSeed() {
    if (this.db.items.length) return;
    const sample = [
      { id: uid('itm_'), name: 'Engine Oil 20W-50', code: 'AH-EO-2050', qty: 35, low: 8, buy: 800, sell: 1200, supplier: 'Atlas Honda', desc: 'Genuine oil for 125cc' },
      { id: uid('itm_'), name: 'Brake Shoe Set', code: 'AH-BS-125', qty: 20, low: 5, buy: 600, sell: 950, supplier: 'Atlas Honda', desc: 'Front/Rear compatible' },
      { id: uid('itm_'), name: 'Spark Plug', code: 'AH-SP-PZ', qty: 55, low: 10, buy: 250, sell: 450, supplier: 'NGK', desc: 'PZ type' },
      { id: uid('itm_'), name: 'Air Filter', code: 'AH-AF-125', qty: 18, low: 5, buy: 300, sell: 520, supplier: 'Atlas Honda', desc: 'Genuine' }
    ];
    this.db.items = sample;
    for (const it of sample) {
      this.db.movements.push({ id: uid('mov_'), ts: Date.now() - 2 * 86400000, ref: it.id, code: it.code, name: it.name, qty: it.qty, dir: 'in', reason: 'seed' });
    }

    const inv = {
      id: uid('inv_'),
      ts: Date.now() - 86400000,
      cust: 'Walk-in',
      items: [
        { ref: sample[0].id, name: sample[0].name, code: sample[0].code, qty: 2, price: 1200, type: 'part' },
        { ref: sample[2].id, name: sample[2].name, code: sample[2].code, qty: 1, price: 450, type: 'part' },
        { name: 'Oil Change Service', qty: 1, price: 500, type: 'service' }
      ],
      subtotal: 3350, discount: 0, tax: 0, total: 3350
    };
    this.db.invoices = [inv];
    for (const line of inv.items.filter(i => i.type === 'part')) {
      this.db.movements.push({ id: uid('mov_'), ts: inv.ts, ref: line.ref, code: line.code, name: line.name, qty: line.qty, dir: 'out', reason: 'sale' });
      const it = this.db.items.find(i => i.id === line.ref); if (it) it.qty -= line.qty;
    }
    this.persist();
  }

  // ---- role UI: show/hide nav buttons and optionally validate admin key
  applyRoleUI(role, { initial = false } = {}) {
    const navBtns = $$('#nav button');
    // hide all initially
    navBtns.forEach(b => b.style.display = 'none');

    // always visible
    const show = name => {
      const el = document.querySelector(`#nav button[data-view="${name}"]`);
      if (el) el.style.display = 'inline-block';
    };
    show('dashboard');
    show('returns');

    if (role === 'agent') {
      show('billing');
    } else if (role === 'inventory') {
      show('inventory');
    } else if (role === 'service') {
      show('workshop');
    } else if (role === 'admin') {
      // if initial load and role was stored as 'admin', assume previously authorized
      if (!initial) {
        const entered = prompt('Enter Admin Key:');
        if (entered !== ADMIN_KEY) {
          alert('❌ Invalid admin key. Staying as agent.');
          this.state.role = 'agent';
          Store.set('role', 'agent');
          $('#roleSelect').value = 'agent';
          this.applyRoleUI('agent', { initial: false });
          return;
        }
      }
      // authorized admin - show admin-only entries
      show('inventory');
      show('workshop');
      show('reports');
      show('billing'); // admin can also bill
    }

    // update role select UI if present and persist
    if ($('#roleSelect')) $('#roleSelect').value = role;
    this.state.role = role;
    Store.set('role', role);
    this.persist();
  }

  // ---- Router
  go(view) {
    if (view === 'reports' && this.state.role !== 'admin') {
      this.toast('Access denied — reports are for admins only');
      view = 'dashboard';
    }
    this.state.view = view;
    $('#view').innerHTML = '';
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const route = this.routes[view];
    if (route) route(); else this.toast('Unknown view');
  }

  // ---- Utilities
  toast(msg) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; $('#toast').appendChild(el); setTimeout(() => el.remove(), 3000);
  }
  findItemByCode(code) { return this.db.items.find(i => i.code.toLowerCase() === String(code || '').toLowerCase()); }
  kpis() {
    const sales = this.db.invoices.reduce((a, x) => a + (x.total || 0), 0);
    const svc = this.db.invoices.reduce((a, x) => a + x.items.filter(i => i.type === 'service').reduce((s, y) => s + y.qty * y.price, 0), 0);
    const stock = this.db.items.reduce((a, x) => a + x.qty, 0);
    const grossPartsRev = this.db.invoices.reduce((a, inv) => a + inv.items.filter(i => i.type === 'part').reduce((s, x) => s + x.qty * x.price, 0), 0);
    const cogs = this.db.invoices.reduce((a, inv) => a + inv.items.filter(i => i.type === 'part').reduce((s, x) => {
      const it = this.db.items.find(t => t.id === x.ref);
      return s + (x.qty * (it?.buy || 0));
    }, 0), 0);
    const grossProfit = grossPartsRev - cogs + svc;
    return { sales, services: svc, stock, grossProfit };
  }

  // ---- Dashboard
  renderDashboard() {
    const low = this.db.items.filter(i => i.qty <= (i.low ?? 5));
    const k = this.kpis();
    const role = this.state.role;
    const roleBadge = role[0].toUpperCase() + role.slice(1);

    $('#view').innerHTML = `
      <div class="cards">
        <div class="card"><div class="title">Total Sales</div><div class="value">Rs ${fmt(k.sales)}</div><div class="sub">All invoices</div></div>
        <div class="card"><div class="title">Service Revenue</div><div class="value">Rs ${fmt(k.services)}</div><div class="sub">Workshop</div></div>
        <div class="card"><div class="title">Stock on Hand</div><div class="value">${fmt(k.stock)}</div><div class="sub">Units</div></div>
        ${role === 'admin' ? `<div class="card"><div class="title">Gross Profit</div><div class="value">Rs ${fmt(k.grossProfit)}</div><div class="sub">Approx (parts COGS)</div></div>` : ''}
        <div class="card warn"><div class="title">Low Stock Alerts</div><div class="value">${low.length} items</div><div class="sub"><span class="badge red">Alerts</span></div></div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3 style="margin:0 0 8px">Today Activity <span class="badge">${roleBadge}</span></h3>
          <div class="grid3">
            <div class="kpi"><span class="badge">Invoices</span> <b>${this.db.invoices.length}</b></div>
            <div class="kpi"><span class="badge">Returns</span> <b>${this.db.returns.length}</b></div>
            <div class="kpi"><span class="badge">Items</span> <b>${this.db.items.length}</b></div>
          </div>
          <canvas id="donutPartsVsSvc" height="120" style="margin-top:10px"></canvas>
        </div>

        <div class="card">
          <h3 style="margin:0 0 8px">Inventory Movement (7d)</h3>
          <canvas id="lineInOut" height="120"></canvas>
        </div>
      </div>
    `;

    // Chart: parts vs service revenue
    const partsRev = this.db.invoices.reduce((a, inv) => a + inv.items.filter(i => i.type !== 'service').reduce((s, x) => s + x.qty * x.price, 0), 0);
    const svcRev = this.db.invoices.reduce((a, inv) => a + inv.items.filter(i => i.type === 'service').reduce((s, x) => s + x.qty * x.price, 0), 0);

    try {
      new Chart($('#donutPartsVsSvc'), {
        type: 'doughnut',
        data: { labels: ['Spare Parts', 'Workshop Service'], datasets: [{ data: [partsRev, svcRev], backgroundColor: ['#e51b2366', '#22c55e66'], borderColor: ['#e51b23', '#22c55e'] }] }
      });
    } catch (e) { /* Chart.js may not be loaded in some tests */ }

    // Chart: In/Out last 7 days
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0, 0, 0, 0); return d; });
    const labelFmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
    const agg = dir => days.map(d => {
      const next = new Date(d); next.setDate(next.getDate() + 1);
      return this.db.movements.filter(m => m.dir === dir && m.ts >= d.getTime() && m.ts < next.getTime()).reduce((a, x) => a + x.qty, 0);
    });

    try {
      new Chart($('#lineInOut'), {
        type: 'bar',
        data: {
          labels: days.map(labelFmt),
          datasets: [
            { label: 'In', data: agg('in'), backgroundColor: '#22c55e66', borderColor: '#22c55e' },
            { label: 'Out', data: agg('out'), backgroundColor: '#e51b2366', borderColor: '#e51b23' }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });
    } catch (e) { /* ignore chart errors */ }
  }

  // ---- Inventory
  renderInventory() {
    const q = (this.state.filter || '').toLowerCase();
    const rows = this.db.items
      .filter(i => [i.name, i.code, i.supplier].join(' ').toLowerCase().includes(q))
      .map(i => `
        <tr>
          <td>${i.name}<div class="badge">${i.code}</div></td>
          <td>${i.qty} ${i.qty <= (i.low ?? 5) ? '<span class="badge red">LOW</span>' : ''}</td>
          <td>Rs ${fmt(i.buy)}</td>
          <td>Rs ${fmt(i.sell)}</td>
          <td>${i.supplier || '-'}</td>
          <td>
            <button class="ghost" data-act="qr" data-id="${i.id}">QR</button>
            <button class="ghost" data-act="edit" data-id="${i.id}">Edit</button>
            <button class="ghost" data-act="del" data-id="${i.id}">Del</button>
          </td>
        </tr>
      `).join('');

    const exportInvBtn = this.state.role === 'admin' ? `<button class="ghost" id="exportInv">Export Excel</button>` : '';

    $('#view').innerHTML = `
      <div class="actions">
        <button class="primary" id="addItemBtn">+ Add Item</button>
        <button class="ghost" id="scanBtn">Scan QR</button>
        ${exportInvBtn}
      </div>
      <div class="card">
        <table class="table">
          <thead><tr><th>Item</th><th>Qty</th><th>Purchase</th><th>Selling</th><th>Supplier</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No items</td></tr>'}</tbody>
        </table>
      </div>
      <div class="grid2">
        <div class="card">
          <h3 style="margin:0">QR Preview</h3>
          <div class="qr" id="qrBox">QR</div>
        </div>
        <div id="qrScanner" class="card" style="display:none">
          <h3 style="margin:0">QR Scanner</h3>
          <div id="reader" style="width:260px"></div>
          <button class="ghost" id="stopScan">Stop</button>
        </div>
      </div>
    `;

    $('#addItemBtn').onclick = () => this.openItemModal();
    $('#exportInv')?.addEventListener('click', () => this.exportInventory());
    $('#scanBtn').onclick = () => this.startScanner();
    $('#stopScan')?.addEventListener('click', () => this.stopScanner());
    $$('#view [data-act]').forEach(btn => btn.onclick = (e) => this.inventoryAction(e.currentTarget));
  }

  openItemModal(item = null) {
    const dlg = $('#itemModal'); const form = $('#itemForm'); $('#itemModalTitle').textContent = item ? 'Edit Item' : 'Add Item';
    form.reset();
    if (item) {
      form.name.value = item.name; form.code.value = item.code; form.qty.value = item.qty;
      form.low.value = item.low ?? 5; form.buy.value = item.buy; form.sell.value = item.sell;
      form.supplier.value = item.supplier || ''; form.desc.value = item.desc || '';
    }
    dlg.showModal();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const data = Object.fromEntries(new FormData(form).entries());
      const payload = { id: item?.id || uid('itm_'), name: data.name, code: data.code, qty: +data.qty, low: +data.low || 5, buy: +data.buy, sell: +data.sell, supplier: data.supplier, desc: data.desc };
      if (item) {
        const delta = (+data.qty) - (item.qty || 0);
        Object.assign(this.db.items.find(x => x.id === item.id), payload);
        if (delta !== 0) {
          this.db.movements.push({ id: uid('mov_'), ts: Date.now(), ref: item.id, code: item.code, name: item.name, qty: Math.abs(delta), dir: delta > 0 ? 'in' : 'out', reason: 'adjustment' });
        }
        this.toast('Item updated');
      } else {
        if (this.db.items.some(i => i.code === payload.code)) return this.toast('Code already exists');
        this.db.items.push(payload);
        this.db.movements.push({ id: uid('mov_'), ts: Date.now(), ref: payload.id, code: payload.code, name: payload.name, qty: payload.qty, dir: 'in', reason: 'adjustment' });
        this.toast('Item added');
      }
      this.persist(); this.renderInventory();
    };
  }

  inventoryAction(btn) {
    const id = btn.dataset.id; const item = this.db.items.find(i => i.id === id);
    if (btn.dataset.act === 'edit') return this.openItemModal(item);
    if (btn.dataset.act === 'del') {
      this.db.movements.push({ id: uid('mov_'), ts: Date.now(), ref: item.id, code: item.code, name: item.name, qty: item.qty, dir: 'out', reason: 'adjustment' });
      this.db.items = this.db.items.filter(i => i.id !== id); this.persist(); this.toast('Deleted'); return this.renderInventory();
    }
    if (btn.dataset.act === 'qr') { const box = $('#qrBox'); box.innerHTML = ''; new QRCode(box, { text: item.code, width: 120, height: 120 }); }
  }

  startScanner() {
    $('#qrScanner').style.display = 'block';
    this.qr = new Html5Qrcode("reader");
    this.qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 200 }, (decoded) => {
      this.state.filter = decoded; this.renderInventory(); this.stopScanner(); this.toast('Scanned: ' + decoded);
    });
  }
  stopScanner() { try { this.qr?.stop().then(() => this.qr.clear()); } catch { } }

  exportInventory() {
    if (this.state.role !== 'admin') { return this.toast('Export restricted to admin'); }
    const ws = XLSX.utils.json_to_sheet(this.db.items);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "inventory.xlsx");
  }

  // ---- Billing
  renderBilling() {
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
    const renderRows = () => {
      const tb = $('#billTable tbody'); tb.innerHTML = this.bill.map((r, i) => `
        <tr>
          <td>${r.name}</td>
          <td><input data-i="${i}" data-k="qty" type="number" min="1" value="${r.qty}" style="width:70px"/></td>
          <td><input data-i="${i}" data-k="price" type="number" min="0" step="0.01" value="${r.price}" style="width:100px"/></td>
          <td>Rs ${fmt(r.qty * r.price)}</td>
          <td><button class="ghost" data-del="${i}">✕</button></td>
        </tr>
      `).join('');
      tb.querySelectorAll('input').forEach(inp => inp.oninput = () => { const i = +inp.dataset.i; const k = inp.dataset.k; this.bill[i][k] = +inp.value; updateTotals(); });
      tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { this.bill.splice(+b.dataset.del, 1); renderRows(); updateTotals(); });
      updateTotals();
    };
    const updateTotals = () => {
      const sub = this.bill.reduce((a, x) => a + x.qty * x.price, 0);
      $('#subTotal').value = sub.toFixed(2);
      const discount = +$('#discount').value || 0;
      const tax = +$('#tax').value || 0;
      $('#grand').textContent = fmt((sub - discount + tax));
    };
    $('#discount').oninput = $('#tax').oninput = updateTotals;

    const addItemByCode = code => {
      const item = this.findItemByCode(code) || this.db.items.find(i => i.name.toLowerCase().includes(String(code || '').toLowerCase()));
      if (!item) return this.toast('Not found');
      this.bill.push({ ref: item.id, type: 'part', name: item.name, code: item.code, qty: 1, price: item.sell });
      renderRows();
    };

    $('#billCode').addEventListener('keydown', e => { if (e.key === 'Enter') { addItemByCode(e.target.value.trim()); e.target.value = ''; } });
    $('#billSearch').addEventListener('input', e => { const q = e.target.value.trim(); if (q.length > 2) addItemByCode(q); });
    $('#billScan').onclick = () => { this.startScanner(); const t = setInterval(() => { if (this.state.filter) { addItemByCode(this.state.filter); this.state.filter = ''; this.stopScanner(); clearInterval(t); } }, 400); };
    $('#addService').onclick = () => { this.bill.push({ type: 'service', name: prompt('Service name', 'General Service') || 'Service', qty: 1, price: +prompt('Charge', '500') || 500 }); renderRows(); };
    $('#billSave').onclick = () => {
      if (!this.bill.length) return this.toast('Empty bill');
      for (const r of this.bill.filter(x => x.type === 'part')) {
        const it = this.db.items.find(i => i.id === r.ref);
        if (!it || it.qty < r.qty) return this.toast(`Insufficient stock for ${r?.name}`);
      }
      const sub = this.bill.reduce((a, x) => a + x.qty * x.price, 0);
      const inv = { id: uid('inv_'), ts: Date.now(), cust: $('#billCust').value || 'Walk-in', items: this.bill, subtotal: sub, discount: +$('#discount').value || 0, tax: +$('#tax').value || 0 };
      inv.total = sub - inv.discount + inv.tax;
      this.db.invoices.push(inv);
      for (const r of inv.items.filter(x => x.type === 'part')) {
        const it = this.db.items.find(i => i.id === r.ref); it.qty -= r.qty;
        this.db.movements.push({ id: uid('mov_'), ts: inv.ts, ref: it.id, code: it.code, name: it.name, qty: r.qty, dir: 'out', reason: 'sale' });
      }
      this.persist(); this.toast('Invoice ' + inv.id + ' saved'); this.printInvoice(inv); this.go('dashboard');
    };
  }

  printInvoice(inv) {
    const w = window.open('', 'print');
    const rows = inv.items.map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.price}</td><td>${i.qty * i.price}</td></tr>`).join('');
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

  // ---- Returns
  renderReturns() {
    $('#view').innerHTML = `
      <div class="card">
        <label>Find Invoice <input id="retInv" placeholder="Enter invoice ID"/></label>
        <div class="actions" style="margin-top:10px">
          <button class="primary" id="loadInv">Load</button>
        </div>
        <div id="retBox"></div>
      </div>
    `;
    $('#loadInv').onclick = () => {
      const id = $('#retInv').value.trim(); const inv = this.db.invoices.find(i => i.id === id);
      if (!inv) return this.toast('Not found');
      $('#retBox').innerHTML = `
        <table class="table"><thead><tr><th>Item</th><th>Qty</th><th>Return</th></tr></thead>
        <tbody>
          ${inv.items.filter(i => i.type === 'part').map((i, idx) => `
            <tr><td>${i.name}</td><td>${i.qty}</td><td><input type="number" min="0" max="${i.qty}" value="0" data-r="${idx}" style="width:90px"/></td></tr>
          `).join('')}
        </tbody></table>
        <div class="actions"><button class="primary" id="doReturn">Process Return & Refund</button></div>
        <div id="retSummary" class="badge"></div>
      `;
      $('#doReturn').onclick = () => {
        const retItems = [...$('#retBox').querySelectorAll('[data-r]')].map(inp => ({ i: +inp.dataset.r, qty: +inp.value || 0 })).filter(x => x.qty > 0);
        if (!retItems.length) return this.toast('Nothing selected');
        const record = { id: uid('ret_'), ts: Date.now(), inv: id, items: [], refund: 0 };
        for (const { i, qty } of retItems) {
          const line = inv.items[i];
          const it = this.db.items.find(x => x.id === line.ref);
          if (it) {
            it.qty += qty; record.items.push({ ref: it.id, name: it.name, qty, price: line.price }); record.refund += qty * line.price;
            this.db.movements.push({ id: uid('mov_'), ts: record.ts, ref: it.id, code: it.code, name: it.name, qty, dir: 'in', reason: 'return' });
          }
        }
        this.db.returns.push(record);
        this.persist();
        $('#retSummary').innerHTML = `Refund amount: <b class="badge green">Rs ${fmt(record.refund)}</b>`;
        this.toast('Return processed. Credit note ' + record.id);
        this.go('dashboard');
      };
    };
  }

  // ---- Workshop
  renderWorkshop() {
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
    this.svcLines = [{ type: 'service', name: $('#svcType')?.value || 'Service Charge', qty: 1, price: 500 }];
    const render = () => {
      $('#svcTable tbody').innerHTML = this.svcLines.map((r, i) => `
        <tr>
          <td>${r.name}</td>
          <td><input data-i="${i}" data-k="qty" type="number" min="1" value="${r.qty}" style="width:70px"/></td>
          <td><input data-i="${i}" data-k="price" type="number" min="0" step="0.01" value="${r.price}" style="width:100px"/></td>
          <td><button class="ghost" data-del="${i}">✕</button></td>
        </tr>
      `).join('');
      $('#svcTable tbody').querySelectorAll('input').forEach(inp => inp.oninput = () => { const i = +inp.dataset.i; const k = inp.dataset.k; this.svcLines[i][k] = +inp.value; });
      $('#svcTable tbody').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { this.svcLines.splice(+b.dataset.del, 1); render(); });
    };
    render();
    $('#svcAddPart').onclick = () => {
      const code = prompt('Enter item code or name');
      if (!code) return;
      const it = this.findItemByCode(code) || this.db.items.find(i => i.name.toLowerCase().includes(code.toLowerCase()));
      if (!it) return this.toast('Not found');
      this.svcLines.push({ type: 'part', ref: it.id, name: it.name, code: it.code, qty: 1, price: it.sell }); render();
    };
    $('#svcSave').onclick = () => {
      const cust = $('#svcCust').value || 'Walk-in', type = $('#svcType').value || 'General Service', desc = $('#svcDesc').value || '';
      for (const r of this.svcLines.filter(x => x.type === 'part')) {
        const it = this.db.items.find(i => i.id === r.ref);
        if (!it || it.qty < r.qty) return this.toast('Insufficient: ' + r.name);
      }
      for (const r of this.svcLines.filter(x => x.type === 'part')) {
        const it = this.db.items.find(i => i.id === r.ref); it.qty -= r.qty;
        this.db.movements.push({ id: uid('mov_'), ts: Date.now(), ref: it.id, code: it.code, name: it.name, qty: r.qty, dir: 'out', reason: 'service' });
      }
      const total = this.svcLines.reduce((a, x) => a + x.qty * x.price, 0);
      const inv = { id: uid('inv_'), ts: Date.now(), cust, items: this.svcLines, subtotal: total, discount: 0, tax: 0, total };
      this.db.invoices.push(inv);
      this.db.services.push({ id: uid('svc_'), ts: Date.now(), cust, type, desc, lines: this.svcLines, total });
      this.persist(); this.toast('Service saved as invoice ' + inv.id); this.go('dashboard');
    };
  }

  // ---- Reports
  renderReports() {
    if (this.state.role !== 'admin') {
      $('#view').innerHTML = `<div class="card"><h3>Access Denied</h3><p>Reports are available to admin users only.</p></div>`;
      return;
    }

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

      <div class="grid2">
        <div class="card">
          <h3 style="margin:0 0 8px">Credit vs Debit</h3>
          <canvas id="creditDebitChart" height="160"></canvas>
        </div>
        <div class="card">
          <h3 style="margin:0 0 8px">Inventory In vs Out</h3>
          <canvas id="inoutChart" height="160"></canvas>
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3 style="margin:0 0 8px">Returns & Refunds</h3>
          <canvas id="returnsChart" height="160"></canvas>
        </div>
        <div class="card">
          <h3 style="margin:0 0 8px">Top Selling (Qty)</h3>
          <table class="table"><thead><tr><th>Name</th><th>Qty</th><th>Revenue</th></tr></thead><tbody id="topBody"></tbody></table>
        </div>
      </div>
    `;

    const bucketKey = (d, period) => {
      if (period === 'daily') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString();
      if (period === 'weekly') { const wk = Math.ceil(d.getDate() / 7); return `${d.getMonth() + 1}/W${wk}/${d.getFullYear()}`; }
      return `${d.getMonth() + 1}/${d.getFullYear()}`;
    };

    const aggregate = (period) => {
      const credit = {}, debit = {}, inQty = {}, outQty = {}, retAmt = {};
      const set = (obj, key, val) => obj[key] = (obj[key] || 0) + val;

      for (const inv of this.db.invoices) {
        const d = new Date(inv.ts); const key = bucketKey(d, period); set(credit, key, inv.total);
        const cost = inv.items.filter(x => x.type === 'part').reduce((s, line) => { const it = this.db.items.find(t => t.id === line.ref); return s + (line.qty * (it?.buy || 0)); }, 0);
        set(debit, key, cost);
      }
      for (const m of this.db.movements) {
        const d = new Date(m.ts); const key = bucketKey(d, period);
        if (m.dir === 'in') set(inQty, key, m.qty); else set(outQty, key, m.qty);
      }
      for (const r of this.db.returns) {
        const d = new Date(r.ts); const key = bucketKey(d, period);
        set(retAmt, key, r.refund || 0); set(debit, key, r.refund || 0);
      }
      const keys = Array.from(new Set([...Object.keys(credit), ...Object.keys(debit), ...Object.keys(inQty), ...Object.keys(outQty), ...Object.keys(retAmt)])).sort((a, b) => (new Date(a)) - (new Date(b)));
      return { keys, credit, debit, inQty, outQty, retAmt };
    };

    const draw = () => {
      const period = $('#period').value;
      const data = aggregate(period);

      if (this.cdChart) this.cdChart.destroy();
      try {
        this.cdChart = new Chart($('#creditDebitChart'), {
          type: 'bar',
          data: { labels: data.keys, datasets: [{ label: 'Credit (Sales)', data: data.keys.map(k => data.credit[k] || 0), backgroundColor: '#22c55e66', borderColor: '#22c55e' }, { label: 'Debit (COGS+Refunds)', data: data.keys.map(k => data.debit[k] || 0), backgroundColor: '#e51b2366', borderColor: '#e51b23' }] },
          options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
      } catch (e) { /* ignore */ }

      if (this.ioChart) this.ioChart.destroy();
      try {
        this.ioChart = new Chart($('#inoutChart'), {
          type: 'line',
          data: { labels: data.keys, datasets: [{ label: 'In', data: data.keys.map(k => data.inQty[k] || 0), backgroundColor: '#22c55e33', borderColor: '#22c55e', tension: .3 }, { label: 'Out', data: data.keys.map(k => data.outQty[k] || 0), backgroundColor: '#e51b2333', borderColor: '#e51b23', tension: .3 }] },
          options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
      } catch (e) { /* ignore */ }

      if (this.retChart) this.retChart.destroy();
      try {
        this.retChart = new Chart($('#returnsChart'), {
          type: 'bar',
          data: { labels: data.keys, datasets: [{ label: 'Refund Amount', data: data.keys.map(k => data.retAmt[k] || 0), backgroundColor: '#eab30833', borderColor: '#f59e0b' }] },
          options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
      } catch (e) { /* ignore */ }

      const aggTop = {};
      for (const inv of this.db.invoices) {
        for (const it of inv.items.filter(x => x.type !== 'service')) {
          const k = it.name; if (!aggTop[k]) aggTop[k] = { qty: 0, rev: 0 };
          aggTop[k].qty += it.qty; aggTop[k].rev += it.qty * it.price;
        }
      }
      const top = Object.entries(aggTop).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
      $('#topBody').innerHTML = top.map(([name, v]) => `<tr><td>${name}</td><td>${v.qty}</td><td>Rs ${fmt(v.rev)}</td></tr>`).join('') || '<tr><td colspan="3">No data</td></tr>';
    };

    draw();
    $('#period').onchange = draw;

    $('#expPdf').onclick = () => {
      if (this.state.role !== 'admin') { return this.toast('Export restricted to admin'); }
      try {
        const doc = new jspdf.jsPDF({ unit: 'pt' });
        const totalSales = this.db.invoices.reduce((a, x) => a + (x.total || 0), 0);
        const totalRefunds = this.db.returns.reduce((a, x) => a + (x.refund || 0), 0);
        doc.text('Business Report', 40, 40);
        doc.text('Generated: ' + new Date().toLocaleString(), 40, 60);
        doc.text('Total Sales: Rs ' + fmt(totalSales), 40, 80);
        doc.text('Total Refunds: Rs ' + fmt(totalRefunds), 40, 100);
        doc.save('report.pdf');
      } catch (e) { this.toast('PDF export failed (check jspdf loaded)'); }
    };

    $('#expXlsx').onclick = () => {
      if (this.state.role !== 'admin') { return this.toast('Export restricted to admin'); }
      try {
        const rows = this.db.invoices.map(i => ({ id: i.id, date: new Date(i.ts).toLocaleString(), total: i.total }));
        const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Invoices"); XLSX.writeFile(wb, "report.xlsx");
      } catch (e) { this.toast('Excel export failed (check xlsx loaded)'); }
    };
  }

  // ---- Global bindings
  bindGlobal() {
    // Nav click -> go(view)
    $$('#nav button').forEach(b => b.onclick = () => this.go(b.dataset.view));
    // Global search
    $('#globalSearch').addEventListener('input', e => { this.state.filter = e.target.value; if (this.state.view === 'inventory') this.renderInventory(); });
    // Backup / restore
    $('#backupBtn').onclick = () => Store.backup();
    $('#restoreBtn').onclick = () => $('#restoreFile').click();
    $('#restoreFile').onchange = e => Store.restore(e.target.files[0]);
    // Role switch: use applyRoleUI to show/hide nav and optionally validate admin
    $('#roleSelect').onchange = (e) => {
      const newRole = e.target.value;
      this.applyRoleUI(newRole, { initial: false });
      // optionally re-render dashboard when switching roles
      if (this.state.view === 'dashboard') this.renderDashboard();
    };
    // Sidebar hamburger (mobile)
    $('#hamburger').onclick = () => { $('#sidebar').classList.toggle('open'); };
  }
}

window.addEventListener('DOMContentLoaded', () => new AppAgent($('#view')));
