import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, ShoppingCart, Package, ArrowDownToLine, 
  History, DollarSign, FileSpreadsheet, Settings, 
  Plus, Minus, Trash2, Search, Check, X, 
  LogOut, UserCircle, Receipt, Printer, AlertTriangle,
  Eye, EyeOff, ShieldCheck, ClipboardCheck, Wallet, Lock, Menu, Database, Download, Upload, ClipboardList
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

const formatRp = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount || 0);
const formatDate = (dateString: string, includeTime = false) => {
  if (!dateString) return '-';
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (includeTime) { options.hour = '2-digit'; options.minute = '2-digit'; }
  return new Date(dateString).toLocaleDateString('id-ID', options);
};
const generateReceiptNumber = () => `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
const generatePONumber = () => `PO-${Date.now().toString().slice(-6)}`;

const simulateHash = (str: string) => btoa(encodeURIComponent(str));
const simulateCompare = (str: string, hash: string) => simulateHash(str) === hash;

const logAudit = async (role: string, action: string, details: string) => {
  await db.audit_logs.add({ id: Date.now().toString(), timestamp: new Date().toISOString(), role, action, details });
};

export default function App() {
  const [loggedInRole, setLoggedInRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const batches = useLiveQuery(() => db.product_batches.toArray(), []) || [];
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().toArray(), []) || [];
  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().toArray(), []) || [];
  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.adjustments.orderBy('date').reverse().toArray(), []) || [];
  const stockOpnames = useLiveQuery(() => db.stock_opnames.orderBy('date').reverse().toArray(), []) || [];
  const cashRegisters = useLiveQuery(() => db.cash_registers.orderBy('date').reverse().toArray(), []) || [];
  const auditLogs = useLiveQuery(() => db.audit_logs.orderBy('timestamp').reverse().toArray(), []) || [];
  const authSettingsRaw = useLiveQuery(() => db.settings.get('auth'), []);
  
  useEffect(() => {
    const seed = async () => {
      const authCount = await db.settings.count();
      if (authCount === 0) {
        await db.settings.put({
          id: 'auth',
          Kasir: simulateHash('kasir123'),
          Inventory: simulateHash('inv123'),
          Pemilik: simulateHash('owner123')
        });
        await db.products.bulkAdd([
          { id: '1', sku: 'BRG001', name: 'Kopi Susu Gula Aren', category: 'Minuman', unit: 'Cup', hpp: 10000, price: 18000, stock: 50, minStock: 10 },
          { id: '2', sku: 'BRG002', name: 'Roti Bakar Coklat Keju', category: 'Makanan', unit: 'Porsi', hpp: 8000, price: 15000, stock: 30, minStock: 5 }
        ]);
        // Seed initial batch for testing FIFO
        const today = new Date().toISOString().split('T')[0];
        await db.product_batches.bulkAdd([
          { id: 'b1', productId: '1', batchNumber: 'BATCH-001', qty: 50, initialQty: 50, hpp: 10000, receivedDate: today, expiryDate: '2027-12-31', condition: 'Baik', createdAt: new Date().toISOString() },
          { id: 'b2', productId: '2', batchNumber: 'BATCH-002', qty: 30, initialQty: 30, hpp: 8000, receivedDate: today, expiryDate: '2027-12-31', condition: 'Baik', createdAt: new Date().toISOString() }
        ]);
      }
    };
    seed();
  }, []);

  if (authSettingsRaw === undefined) return <div className="flex h-screen items-center justify-center bg-[#F8FAFC] text-red-800 font-bold">Memuat Sistem Lokal...</div>;
  const authSettings = authSettingsRaw || { Kasir: '', Inventory: '', Pemilik: '' };

  if (!loggedInRole) return <LoginScreen authSettings={authSettings} onLogin={(role) => { setLoggedInRole(role); setActiveTab('dashboard'); logAudit(role, 'Login', 'Berhasil masuk ke sistem lokal'); }} />;

  const handleLogout = () => { logAudit(loggedInRole, 'Logout', 'Keluar dari sistem lokal'); setLoggedInRole(null); };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Kasir', 'Inventory', 'Pemilik'] },
    { id: 'pos', label: 'Kasir & Transaksi', icon: ShoppingCart, roles: ['Kasir'] },
    { id: 'tutup_kas', label: 'Tutup Kas Harian', icon: Wallet, roles: ['Kasir'] },
    { id: 'products', label: 'Data Persediaan', icon: Package, roles: ['Inventory', 'Pemilik'] },
    { id: 'purchase_orders', label: 'Purchase Order (PO)', icon: ClipboardList, roles: ['Inventory', 'Pemilik'] },
    { id: 'inbound', label: 'Penerimaan Barang', icon: ArrowDownToLine, roles: ['Inventory'] },
    { id: 'stock_opname', label: 'Stock Opname', icon: ClipboardCheck, roles: ['Inventory', 'Pemilik'] },
    { id: 'history', label: 'Riwayat Transaksi', icon: History, roles: ['Kasir', 'Inventory', 'Pemilik'] },
    { id: 'approvals', label: 'Persetujuan (Owner)', icon: ShieldCheck, roles: ['Pemilik'] },
    { id: 'reconciliation', label: 'Rekonsiliasi Kas', icon: ClipboardCheck, roles: ['Pemilik'] },
    { id: 'expenses', label: 'Biaya Operasional', icon: DollarSign, roles: ['Pemilik'] },
    { id: 'reports', label: 'Laporan & Excel', icon: FileSpreadsheet, roles: ['Pemilik'] },
    { id: 'audit', label: 'Jejak Audit', icon: Search, roles: ['Pemilik'] },
    { id: 'settings', label: 'Pengaturan', icon: Settings, roles: ['Pemilik'] },
  ];

  const pendingApprovalsCount = sales.filter(s => s.status === 'cancel_requested').length + purchases.filter(p => p.status === 'pending').length + adjustments.filter(a => a.status === 'pending').length + stockOpnames.filter(so => so.status === 'pending').length;
  const pendingCashCount = cashRegisters.filter(c => c.status === 'pending_review').length;

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard products={products} batches={batches} sales={sales} role={loggedInRole} purchases={purchases} cash={cashRegisters} stockOpnames={stockOpnames} />;
      case 'pos': return <POS products={products} batches={batches} role={loggedInRole} />;
      case 'tutup_kas': return <CashClosing role={loggedInRole} sales={sales} cashRegisters={cashRegisters} />;
      case 'products': return <Products products={products} role={loggedInRole} />;
      case 'purchase_orders': return <PurchaseOrders products={products} purchases={purchases} role={loggedInRole} />;
      case 'inbound': return <Inbound products={products} purchases={purchases} role={loggedInRole} />;
      case 'stock_opname': return <StockOpnameView products={products} stockOpnames={stockOpnames} role={loggedInRole} />;
      case 'history': return <HistoryView sales={sales} purchases={purchases} role={loggedInRole} />;
      case 'approvals': return <Approvals sales={sales} purchases={purchases} adjustments={adjustments} stockOpnames={stockOpnames} products={products} role={loggedInRole} />;
      case 'reconciliation': return <CashReconciliation cashRegisters={cashRegisters} role={loggedInRole} />;
      case 'expenses': return <Expenses expenses={expenses} role={loggedInRole} />;
      case 'reports': return <Reports products={products} sales={sales} role={loggedInRole} />;
      case 'audit': return <AuditTrail logs={auditLogs} role={loggedInRole} />;
      case 'settings': return <SettingsView role={loggedInRole} />;
      default: return <Dashboard products={products} batches={batches} sales={sales} role={loggedInRole} purchases={purchases} cash={cashRegisters} stockOpnames={stockOpnames} />;
    }
  };

  return (
    <div className="flex h-[100dvh] bg-[#F8FAFC] font-sans overflow-hidden text-[#1E293B]">
      <header className="lg:hidden absolute top-0 left-0 w-full h-16 bg-[#991B1B] text-white p-4 flex justify-between items-center z-40 shadow-md">
        <div className="flex items-center gap-2 font-bold text-lg tracking-wide"><Lock size={18}/> POS LOKAL</div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2"><Menu size={24}/></button>
      </header>

      {isMobileMenuOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

      <div className={`fixed inset-y-0 left-0 w-64 bg-[#991B1B] text-white flex flex-col shadow-2xl z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300`}>
        <div className="p-6 bg-[#7F1D1D] border-b border-[#7F1D1D] flex justify-between items-center h-16 lg:h-auto">
          <div><h1 className="text-xl lg:text-2xl font-bold tracking-wider flex items-center gap-2"><Lock size={20} className="text-white" /> POS & INV</h1><p className="text-[#FEE2E2] text-[10px] lg:text-xs mt-1 font-medium tracking-widest uppercase">Sistem Offline</p></div>
          <button className="lg:hidden text-[#FEE2E2] hover:text-white" onClick={() => setIsMobileMenuOpen(false)}><X size={24}/></button>
        </div>
        
        <div className="p-4 bg-[#7F1D1D]/50 border-b border-[#7F1D1D]">
          <div className="flex items-center gap-3"><UserCircle size={32} className="text-[#FEE2E2]" /><div><p className="text-[10px] text-[#FEE2E2]">Masuk sebagai</p><p className="font-bold text-white tracking-wide text-sm">{loggedInRole}</p></div></div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {navItems.filter(item => item.roles.includes(loggedInRole)).map(item => {
            const isActive = activeTab === item.id;
            let badge = null;
            if (item.id === 'approvals' && pendingApprovalsCount > 0) badge = pendingApprovalsCount;
            if (item.id === 'reconciliation' && pendingCashCount > 0) badge = pendingCashCount;
            return (
              <button key={item.id} onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 ${isActive ? 'bg-[#DC2626] text-white shadow-md' : 'hover:bg-[#7F1D1D] text-[#FEE2E2]'}`}>
                <div className="flex items-center space-x-3 text-sm"><item.icon size={18} className={isActive ? 'text-white' : 'text-[#FEE2E2]'} /><span className="font-bold">{item.label}</span></div>
                {badge && <span className="bg-white text-[#DC2626] text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-sm">{badge}</span>}
              </button>
            )
          })}
        </nav>
        
        <div className="p-4 border-t border-[#7F1D1D]">
          <button onClick={handleLogout} className="w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl bg-[#7F1D1D] hover:bg-white hover:text-[#DC2626] transition-colors text-white font-bold text-sm shadow-md">
            <LogOut size={16} /> <span>Keluar Aman</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden w-full pt-16 lg:pt-0">
        <header className="hidden lg:flex bg-white h-16 items-center justify-between px-8 border-b border-[#E2E8F0] shadow-sm z-0">
          <h2 className="text-lg font-bold text-[#1E293B] flex items-center gap-2">{navItems.find(i => i.id === activeTab)?.label}</h2>
          <div className="text-sm font-bold text-[#64748B] flex items-center gap-2">{formatDate(new Date().toISOString(), true)}</div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-7xl mx-auto h-full">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

function LoginScreen({ authSettings, onLogin }: any) {
  const [role, setRole] = useState('Kasir'); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState('');
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    const storedHash = authSettings[role];
    if (simulateCompare(password, storedHash)) onLogin(role); else setError('Password salah untuk peran ini.');
  };
  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border-t-8 border-[#DC2626]">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#FEE2E2] text-[#DC2626] rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm"><Lock size={32} /></div>
          <h2 className="text-2xl font-black text-[#1E293B]">POS LOKAL</h2><p className="text-[#64748B] text-xs font-bold mt-2 uppercase tracking-widest">Sistem Offline Mandiri</p>
        </div>
        {error && <div className="bg-[#FEE2E2] text-[#991B1B] p-3 rounded-lg text-sm font-bold mb-6 text-center border border-[#991B1B] flex items-center justify-center gap-2"><AlertTriangle size={16}/> {error}</div>}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#64748B] mb-2 uppercase">Masuk Sebagai</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full border-2 border-[#E2E8F0] rounded-xl p-3 focus:outline-none focus:border-[#DC2626] bg-white font-bold text-[#1E293B] text-sm">
              <option value="Kasir">Kasir (Transaksi)</option><option value="Inventory">Inventory (Gudang)</option><option value="Pemilik">Pemilik (Finance)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#64748B] mb-2 uppercase">Password</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan password" required className="w-full border-2 border-[#E2E8F0] rounded-xl p-3 pr-12 focus:outline-none focus:border-[#DC2626] font-bold text-[#1E293B] text-sm" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-[#64748B] hover:text-[#DC2626]">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>
          </div>
          <button type="submit" className="w-full bg-[#DC2626] hover:bg-[#991B1B] text-white py-3.5 rounded-xl font-bold shadow-lg transition-all flex justify-center items-center gap-2 text-sm mt-2">Login Offline</button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ products, batches, sales, role, purchases, cash, stockOpnames }: any) {
  const completedSales = sales.filter((s: any) => s.status === 'completed');
  const today = new Date().toISOString().split('T')[0];
  const todaySales = completedSales.filter((s: any) => s.date.startsWith(today));
  const kasirTotalSales = todaySales.reduce((sum: number, s: any) => sum + s.total, 0);
  const totalStock = products.reduce((sum: number, p: any) => sum + p.stock, 0);
  
  // Reorder point & stock status
  const lowStockProducts = products.filter((p: any) => p.stock <= (p.minStock ?? 10));
  const outOfStockProducts = products.filter((p: any) => p.stock === 0);
  
  // Near expiry check (< 30 days)
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const nearExpiryBatches = batches.filter((b: any) => b.qty > 0 && new Date(b.expiryDate) <= thirtyDaysFromNow);

  const pendingPO = purchases.filter((p: any) => p.status === 'pending').length;
  const pendingOpname = stockOpnames.filter((so: any) => so.status === 'pending').length;
  const totalProfitToday = todaySales.reduce((sum: number, s: any) => sum + s.profit, 0);
  const pendingCashCount = cash.filter((c: any) => c.status === 'pending_review').length;

  const StatCard = ({ title, value, sub, icon: Icon, alertClass }: any) => (
    <div className={`bg-white rounded-2xl shadow-sm p-5 border ${alertClass || 'border-[#E2E8F0]'} flex items-center space-x-4`}>
      <div className={`p-4 rounded-xl bg-[#FEE2E2] text-[#DC2626]`}><Icon size={24} /></div>
      <div><p className="text-[10px] text-[#64748B] font-bold tracking-wider uppercase">{title}</p><h3 className="text-xl lg:text-2xl font-black text-[#1E293B] mt-1">{value}</h3>{sub && <p className="text-[10px] text-[#64748B] mt-1 font-bold">{sub}</p>}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {role === 'Kasir' && <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><StatCard title="Penerimaan Hari Ini" value={formatRp(kasirTotalSales)} sub="Total omzet tunai & non-tunai" icon={Wallet} /><StatCard title="Total Transaksi" value={todaySales.length} sub="Transaksi berhasil hari ini" icon={Receipt} /></div>}
      {role === 'Inventory' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard title="Total Item Stok" value={`${totalStock} Unit`} icon={Package} />
            <StatCard title="Stok Menipis / Reorder" value={lowStockProducts.length} sub="Mencapai batas minimum" icon={AlertTriangle} alertClass="border-amber-400 bg-amber-50/20" />
            <StatCard title="Mendekati Kedaluwarsa" value={nearExpiryBatches.length} sub="< 30 hari ke depan" icon={AlertTriangle} alertClass="border-red-400 bg-red-50/20" />
            <StatCard title="PO Pending" value={pendingPO} sub="Menunggu approval Pemilik" icon={ClipboardList} />
            <StatCard title="Stok Habis" value={outOfStockProducts.length} sub="Perlu pengadaan segera" icon={Package} alertClass="border-red-400 bg-red-50/20" />
            <StatCard title="Opname Pending" value={pendingOpname} sub="Menunggu review Pemilik" icon={ClipboardCheck} />
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <h3 className="font-black text-base text-[#1E293B] mb-4 flex items-center gap-2"><AlertTriangle className="text-[#DC2626]" size={18}/> Daftar Kebutuhan Pengadaan (Reorder Point)</h3>
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8FAFC] text-[#64748B] uppercase font-black">
                <tr><th className="p-3">SKU & Nama Barang</th><th className="p-3">Stok Tersedia</th><th className="p-3">Min Stok</th><th className="p-3">Kekurangan (Kebutuhan)</th></tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] font-bold">
                {lowStockProducts.length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-center text-[#64748B]">Semua stok aman di atas batas minimum.</td></tr>
                ) : lowStockProducts.map((p: any) => {
                  const shortage = Math.max(0, (p.minStock ?? 10) * 2 - p.stock);
                  return (
                    <tr key={p.id} className="hover:bg-[#F8FAFC]">
                      <td className="p-3">{p.sku} - {p.name}</td>
                      <td className="p-3 text-[#DC2626]">{p.stock} {p.unit}</td>
                      <td className="p-3">{p.minStock ?? 10} {p.unit}</td>
                      <td className="p-3 text-amber-700 font-black">+{shortage} {p.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {role === 'Pemilik' && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"><StatCard title="Omzet Hari Ini" value={formatRp(kasirTotalSales)} icon={DollarSign} /><StatCard title="Laba Kotor Hari Ini" value={formatRp(totalProfitToday)} icon={BarChart} /><StatCard title="Stok Menipis" value={lowStockProducts.length} icon={AlertTriangle} /><StatCard title="Review Kas Pending" value={pendingCashCount} icon={ClipboardCheck} /></div>}
    </div>
  );
}

function POS({ products, batches, role }: any) {
  if (role !== 'Kasir') return null;
  const [cart, setCart] = useState<any[]>([]); const [searchTerm, setSearchTerm] = useState(''); const [paymentAmount, setPaymentAmount] = useState(''); const [paymentMethod, setPaymentMethod] = useState('Tunai'); const [isProcessing, setIsProcessing] = useState(false); const [receiptData, setReceiptData] = useState<any>(null); const [isCartOpen, setIsCartOpen] = useState(false);

  const activeProducts = products.filter((p: any) => p.stock > 0 && (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase())));
  
  const addToCart = (product: any) => {
    const existing = cart.find(item => item.productId === product.id);
    if (existing) { if (existing.qty < product.stock) setCart(cart.map(item => item.productId === product.id ? { ...item, qty: item.qty + 1 } : item)); } 
    else { setCart([...cart, { productId: product.id, name: product.name, price: product.price, hpp: product.hpp, qty: 1, unit: product.unit, maxStock: product.stock }]); }
  };
  const updateQty = (productId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.productId === productId) {
        const newQty = item.qty + delta;
        if (newQty > 0 && newQty <= item.maxStock) return { ...item, qty: newQty };
      }
      return item;
    }));
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const changeAmount = parseFloat(paymentAmount || '0') - totalAmount;

  const handleCheckout = async () => {
    if (cart.length === 0) return; if (paymentMethod === 'Tunai' && changeAmount < 0) return alert("Pembayaran kurang!");
    setIsProcessing(true);
    try {
      const receiptNo = generateReceiptNumber(); let totalHPP = 0; let totalProfit = 0;
      const todayStr = new Date().toISOString().split('T')[0];

      // Process FIFO batch allocation
      const allocatedItems = [];
      const batchUpdates: { batchId: string; newQty: number }[] = [];
      const productStockUpdates: { productId: string; reduceQty: number }[] = [];

      for (const cartItem of cart) {
        let remainingNeeded = cartItem.qty;
        // Fetch active non-expired batches for this product sorted by receivedDate/expiryDate ASC (FIFO)
        const productBatches = batches
          .filter((b: any) => b.productId === cartItem.productId && b.qty > 0 && b.condition === 'Baik' && b.expiryDate >= todayStr)
          .sort((a: any, b: any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());

        let itemTotalHPP = 0;
        for (const batch of productBatches) {
          if (remainingNeeded <= 0) break;
          const takeFromBatch = Math.min(batch.qty, remainingNeeded);
          itemTotalHPP += takeFromBatch * batch.hpp;
          remainingNeeded -= takeFromBatch;

          const existingUpdate = batchUpdates.find(bu => bu.batchId === batch.id);
          if (existingUpdate) {
            existingUpdate.newQty -= takeFromBatch;
          } else {
            batchUpdates.push({ batchId: batch.id, newQty: batch.qty - takeFromBatch });
          }
        }

        if (remainingNeeded > 0) {
          alert(`Stok batch aktif tidak mencukupi untuk produk ${cartItem.name}!`);
          setIsProcessing(false);
          return;
        }

        const subtotal = cartItem.price * cartItem.qty;
        totalHPP += itemTotalHPP;
        totalProfit += (subtotal - itemTotalHPP);

        allocatedItems.push({ ...cartItem, subtotal, itemHPP: itemTotalHPP, itemProfit: subtotal - itemTotalHPP });
        productStockUpdates.push({ productId: cartItem.productId, reduceQty: cartItem.qty });
      }

      const saleData = { 
        id: Date.now().toString(), 
        receiptNumber: receiptNo, 
        date: new Date().toISOString(), 
        items: allocatedItems, 
        total: totalAmount, 
        hppTotal: totalHPP, 
        profit: totalProfit, 
        paymentMethod: paymentMethod, 
        paymentReceived: paymentMethod === 'Tunai' ? parseFloat(paymentAmount || '0') : totalAmount, 
        change: paymentMethod === 'Tunai' ? Math.max(changeAmount, 0) : 0, 
        status: 'completed', 
        cashierRole: 'Kasir' 
      };

      await db.transaction('rw', db.sales, db.products, db.product_batches, db.audit_logs, async () => {
        await db.sales.add(saleData);
        for (const bu of batchUpdates) {
          await db.product_batches.update(bu.batchId, { qty: bu.newQty });
        }
        for (const psu of productStockUpdates) {
          const prod = await db.products.get(psu.productId);
          if (prod) await db.products.update(psu.productId, { stock: Math.max(0, prod.stock - psu.reduceQty) });
        }
        await db.audit_logs.add({ id: Date.now().toString(), timestamp: new Date().toISOString(), role: 'Kasir', action: 'Transaksi Penjualan (FIFO)', details: `Transaksi ${receiptNo}` });
      });

      setReceiptData(saleData); setCart([]); setPaymentAmount(''); setPaymentMethod('Tunai'); setIsCartOpen(false);
    } catch (error) { alert("Error saat checkout POS"); }
    setIsProcessing(false);
  };

  if (receiptData) return (
    <div className="flex justify-center items-center h-full"><div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm border border-[#E2E8F0]">
      <div className="text-center mb-4"><Check size={40} className="mx-auto text-[#DC2626] mb-2" /><h2 className="text-xl font-black">Transaksi Berhasil</h2><p className="text-[#64748B] font-mono text-xs mt-1">{receiptData.receiptNumber}</p></div>
      <div className="border-y border-dashed border-[#E2E8F0] py-4 mb-4 space-y-2 text-sm">{receiptData.items.map((item: any, idx: number) => ( <div key={idx} className="flex justify-between font-bold text-[#1E293B] text-xs"><div><p>{item.name}</p><p className="text-[#64748B]">{item.qty} x {formatRp(item.price)}</p></div><p>{formatRp(item.subtotal)}</p></div> ))}</div>
      <div className="mt-6 flex gap-3"><button onClick={() => window.print()} className="flex-1 bg-[#F8FAFC] border-2 border-[#E2E8F0] text-[#1E293B] py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Printer size={16} /> Cetak</button><button onClick={() => setReceiptData(null)} className="flex-1 bg-[#DC2626] text-white py-3 rounded-xl font-bold shadow-md text-sm">Selesai</button></div>
    </div></div>
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-10rem)] gap-0 lg:gap-6 relative">
      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        <div className="p-4 bg-white border-b border-[#E2E8F0]"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#64748B]" size={18} /><input type="text" placeholder="Cari barang atau SKU..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[#E2E8F0] focus:outline-none focus:border-[#DC2626] font-bold text-sm bg-[#F8FAFC]" /></div></div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {activeProducts.map((p: any) => (
              <div key={p.id} onClick={() => addToCart(p)} className="bg-white border-2 border-[#E2E8F0] rounded-xl p-3 cursor-pointer hover:border-[#DC2626] transition flex flex-col shadow-sm">
                <span className="text-[9px] font-black text-white bg-[#64748B] px-1.5 py-0.5 rounded w-fit mb-2">Stok: {p.stock}</span>
                <h4 className="font-bold text-[#1E293B] text-xs leading-tight mb-1 flex-1">{p.name}</h4>
                <div className="flex justify-between items-end mt-2"><span className="font-black text-[#DC2626] text-sm">{formatRp(p.price)}</span><div className="bg-[#FEE2E2] p-1.5 rounded-lg text-[#DC2626]"><Plus size={14}/></div></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className="lg:hidden fixed bottom-6 right-6 bg-[#DC2626] text-white p-4 rounded-full shadow-2xl z-40" onClick={() => setIsCartOpen(true)}><ShoppingCart size={24} /><span className="absolute -top-2 -right-2 bg-white text-[#DC2626] font-black border-2 border-[#DC2626] rounded-full w-7 h-7 flex items-center justify-center text-xs">{cart.length}</span></button>

      <div className={`fixed inset-0 z-50 bg-black/60 transition-opacity lg:hidden ${isCartOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsCartOpen(false)}></div>
      <div className={`fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl z-50 transform ${isCartOpen ? 'translate-x-0' : 'translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300 flex flex-col shrink-0 border-l lg:border-none lg:rounded-2xl border-[#E2E8F0]`}>
        <div className="p-4 bg-white border-b border-[#E2E8F0] flex justify-between items-center lg:rounded-t-2xl"><h3 className="font-black text-[#1E293B] flex items-center gap-2"><ShoppingCart size={18}/> Keranjang</h3><div className="flex items-center gap-3"><span className="bg-[#FEE2E2] text-[#991B1B] text-xs font-black px-2 py-1 rounded-md">{cart.length} Item</span><button className="lg:hidden text-[#64748B]" onClick={() => setIsCartOpen(false)}><X size={20}/></button></div></div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-2 bg-[#F8FAFC]">
          {cart.map(item => (
            <div key={item.productId} className="bg-white border border-[#E2E8F0] p-3 rounded-xl shadow-sm">
              <div className="flex justify-between mb-2"><span className="font-bold text-xs text-[#1E293B]">{item.name}</span><button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))} className="text-[#64748B] hover:text-[#DC2626]"><Trash2 size={14}/></button></div>
              <div className="flex justify-between items-center"><span className="text-xs font-black text-[#DC2626]">{formatRp(item.price)}</span><div className="flex items-center gap-2 bg-[#F8FAFC] rounded-lg p-1 border border-[#E2E8F0]"><button onClick={() => updateQty(item.productId, -1)} className="p-1 bg-white rounded shadow-sm text-[#1E293B]"><Minus size={12}/></button><span className="text-xs font-black w-4 text-center">{item.qty}</span><button onClick={() => updateQty(item.productId, 1)} className="p-1 bg-white rounded shadow-sm text-[#1E293B]"><Plus size={12}/></button></div></div>
            </div>
          ))}
        </div>
        <div className="p-4 bg-white border-t border-[#E2E8F0] lg:rounded-b-2xl space-y-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between font-black text-base text-[#1E293B]"><span>Total</span><span className="text-[#DC2626]">{formatRp(totalAmount)}</span></div>
          <div>
             <div className="grid grid-cols-2 gap-2 mb-2">{['Tunai', 'Transfer'].map(m => (<button key={m} onClick={() => setPaymentMethod(m)} className={`py-2.5 rounded-xl text-xs font-black border-2 transition ${paymentMethod === m ? 'bg-[#DC2626] text-white border-[#DC2626]' : 'bg-white text-[#64748B] border-[#E2E8F0]'}`}>{m}</button>))}</div>
             {paymentMethod === 'Tunai' && (<input type="number" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="Nominal Uang" className="w-full p-3 rounded-xl border-2 border-[#E2E8F0] font-black text-sm focus:border-[#DC2626] outline-none bg-[#F8FAFC]"/>)}
          </div>
          <button onClick={handleCheckout} disabled={cart.length === 0 || isProcessing || (paymentMethod==='Tunai' && changeAmount < 0 && paymentAmount !== '')} className="w-full bg-[#DC2626] hover:bg-[#991B1B] disabled:bg-[#cbd5e1] disabled:text-[#f1f5f9] text-white py-3.5 rounded-xl font-black text-sm shadow-md transition">Selesai Pembayaran</button>
        </div>
      </div>
    </div>
  );
}

function Products({ products, role }: any) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalType, setModalType] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({});
  
  const filtered = products.filter((p: any) => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { 
        sku: formData.sku, 
        name: formData.name, 
        category: formData.category, 
        unit: formData.unit, 
        hpp: Number(formData.hpp), 
        price: Number(formData.price),
        minStock: Number(formData.minStock || 10)
      };
      if (formData.id) {
        await db.products.update(formData.id, payload);
        await logAudit('Pemilik', 'Ubah Master Barang', `Ubah ${formData.name}`);
      } else {
        await db.products.add({ id: Date.now().toString(), ...payload, stock: 0 });
        await logAudit('Pemilik', 'Tambah Master Barang', `Tambah ${formData.name}`);
      }
      setModalType(null);
    } catch (err) { alert("Error menyimpan lokal"); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col h-full overflow-hidden">
      <div className="p-4 md:p-6 border-b border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" size={16} />
          <input type="text" placeholder="Cari barang atau SKU..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-xl border-2 border-[#E2E8F0] focus:outline-none focus:border-[#DC2626] font-bold text-sm bg-[#F8FAFC]" />
        </div>
        {role === 'Pemilik' && (
          <button onClick={() => { setFormData({ id: null, sku: '', name: '', category: '', unit: 'Pcs', hpp: 0, price: 0, minStock: 10 }); setModalType('edit'); }} className="w-full sm:w-auto bg-[#DC2626] hover:bg-[#991B1B] text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md text-sm">
            <Plus size={16}/> Tambah Barang
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead className="bg-[#F8FAFC] text-[#64748B] text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-[#E2E8F0]">
            <tr><th className="p-4">SKU</th><th className="p-4">Nama Barang</th>{role === 'Pemilik' && <th className="p-4 text-right">HPP</th>}<th className="p-4 text-right">Harga Jual</th><th className="p-4 text-center">Min Stok</th><th className="p-4 text-center">Stok</th><th className="p-4 text-center">Aksi</th></tr>
          </thead>
          <tbody className="text-xs font-bold text-[#1E293B] divide-y divide-[#E2E8F0]">
            {filtered.map((p: any) => (
              <tr key={p.id} className="hover:bg-[#F8FAFC]">
                <td className="p-4 text-[#64748B] font-mono">{p.sku}</td>
                <td className="p-4">{p.name} <span className="text-[10px] text-[#64748B] block mt-0.5">{p.category}</span></td>
                {role === 'Pemilik' && <td className="p-4 text-right text-[#64748B]">{formatRp(p.hpp)}</td>}
                <td className="p-4 text-right text-[#DC2626]">{formatRp(p.price)}</td>
                <td className="p-4 text-center">{p.minStock ?? 10}</td>
                <td className="p-4 text-center"><span className={`px-2 py-1 rounded text-[10px] ${p.stock <= (p.minStock ?? 10) ? 'bg-[#991B1B] text-white' : 'bg-[#E2E8F0] text-[#1E293B]'}`}>{p.stock} {p.unit}</span></td>
                <td className="p-4 text-center">
                  {role === 'Pemilik' && <button onClick={() => { setFormData(p); setModalType('edit'); }} className="text-[#DC2626] hover:underline">Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {modalType === 'edit' && role === 'Pemilik' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[#E2E8F0] overflow-hidden">
            <div className="p-5 border-b border-[#E2E8F0] bg-white flex justify-between items-center"><h3 className="font-black text-[#1E293B]">{formData.id ? 'Edit Master Barang' : 'Tambah Master Barang'}</h3><button onClick={() => setModalType(null)}><X size={20}/></button></div>
            <form onSubmit={handleSaveEdit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-[10px] font-black text-[#64748B] mb-1">SKU</label><input required type="text" value={formData.sku} onChange={e=>setFormData({...formData, sku: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none focus:border-[#DC2626] text-sm font-bold bg-[#F8FAFC]" /></div>
                <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Kategori</label><input required type="text" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none focus:border-[#DC2626] text-sm font-bold bg-[#F8FAFC]" /></div>
              </div>
              <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Nama Barang</label><input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none focus:border-[#DC2626] text-sm font-bold bg-[#F8FAFC]" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-[10px] font-black text-[#64748B] mb-1">HPP (Rp)</label><input required type="number" value={formData.hpp} onChange={e=>setFormData({...formData, hpp: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none text-sm font-bold bg-[#F8FAFC]" /></div>
                <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Harga Jual</label><input required type="number" value={formData.price} onChange={e=>setFormData({...formData, price: e.target.value})} className="w-full border-2 border-[#DC2626] rounded-xl p-2.5 outline-none text-sm font-bold text-[#DC2626] bg-[#FEE2E2]/30" /></div>
                <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Batas Min Stok</label><input required type="number" value={formData.minStock} onChange={e=>setFormData({...formData, minStock: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none text-sm font-bold bg-[#F8FAFC]" /></div>
              </div>
              <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black mt-2 shadow-md">Simpan ke Lokal</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PurchaseOrders({ products, purchases, role }: any) {
  const [selectedProduct, setSelectedProduct] = useState(''); const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState(''); const [price, setPrice] = useState(''); const [notes, setNotes] = useState('');

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = products.find((prod: any) => prod.id === selectedProduct);
    if (!p) return;
    try {
      const poNum = generatePONumber();
      const poData = {
        id: Date.now().toString(),
        poNumber: poNum,
        date: new Date().toISOString(),
        supplier: supplier || 'Umum',
        items: [{ productId: p.id, name: p.name, qty: Number(qty), price: Number(price), total: Number(qty) * Number(price) }],
        total: Number(qty) * Number(price),
        status: 'pending',
        requestedBy: role,
        notes
      };
      await db.purchases.add(poData);
      await logAudit(role, 'Buat Purchase Order', `Membuat PO ${poNum} untuk ${p.name}`);
      alert("Purchase Order berhasil diajukan ke Pemilik.");
      setSelectedProduct(''); setSupplier(''); setQty(''); setPrice(''); setNotes('');
    } catch (err) { alert("Gagal membuat PO"); }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {role === 'Inventory' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
          <h3 className="font-black text-base text-[#1E293B] mb-4">Buat Purchase Order (PO) Baru</h3>
          <form onSubmit={handleCreatePO} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Pilih Produk</label><select required value={selectedProduct} onChange={e=>setSelectedProduct(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]"><option value="">-- Pilih Barang --</option>{products.map((p:any)=><option key={p.id} value={p.id}>{p.sku} - {p.name} (Stok: {p.stock})</option>)}</select></div>
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Nama Supplier</label><input required type="text" placeholder="PT Supplier Sejahtera" value={supplier} onChange={e=>setSupplier(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Jumlah Pesan (Qty)</label><input required type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Estimasi Harga Beli / Unit (Rp)</label><input required type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} className="w-full p-3 border-2 border-[#DC2626] rounded-xl font-bold text-sm text-[#DC2626] bg-[#FEE2E2]/20" /></div>
            </div>
            <div><label className="block text-xs font-black text-[#64748B] mb-1">Catatan Pengajuan</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-xs bg-[#F8FAFC]"></textarea></div>
            <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black shadow-md">Kirim PO ke Pemilik</button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0] font-black text-sm">Daftar Purchase Order (PO)</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[#64748B] uppercase font-black">
            <tr><th className="p-4">No. PO</th><th className="p-4">Supplier</th><th className="p-4">Item & Qty</th><th className="p-4">Total (Rp)</th><th className="p-4 text-center">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0] font-bold">
            {purchases.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-[#64748B]">Belum ada data PO.</td></tr> : purchases.map((p:any)=>(
              <tr key={p.id} className="hover:bg-[#F8FAFC]">
                <td className="p-4 text-[#DC2626] font-mono">{p.poNumber}</td>
                <td className="p-4">{p.supplier}</td>
                <td className="p-4">{p.items?.[0]?.name} (x{p.items?.[0]?.qty})</td>
                <td className="p-4">{formatRp(p.total)}</td>
                <td className="p-4 text-center">
                  <span className={`px-2.5 py-1 rounded-md text-[10px] ${p.status==='approved'?'bg-green-100 text-green-700':p.status==='rejected'?'bg-red-100 text-[#991B1B]':'bg-amber-100 text-amber-700'}`}>
                    {p.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Inbound({ products, purchases, role }: any) {
  if (role !== 'Inventory') return null;
  const [selectedPO, setSelectedPO] = useState(''); 
  const [goodQty, setGoodQty] = useState(''); 
  const [damagedQty, setDamagedQty] = useState(''); 
  const [batchNumber, setBatchNumber] = useState(''); 
  const [expiryDate, setExpiryDate] = useState(''); 
  const [notes, setNotes] = useState('');

  const approvedPOs = purchases.filter((p: any) => p.status === 'approved');
  const currentPO = approvedPOs.find((p: any) => p.id === selectedPO);

  const handleInboundReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPO) return;
    try {
      const gQty = Number(goodQty || 0);
      const dQty = Number(damagedQty || 0);
      const item = currentPO.items[0];
      const prod = products.find((p: any) => p.id === item.productId);
      if (!prod) return;

      const batchNum = batchNumber || `BATCH-${Date.now().toString().slice(-6)}`;
      const expDate = expiryDate || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0];

      await db.transaction('rw', db.purchases, db.products, db.product_batches, db.audit_logs, async () => {
        // Update PO status to received
        await db.purchases.update(currentPO.id, { status: 'received' });

        // Create Batch for Good Qty ONLY (damaged goods do not enter sellable stock)
        if (gQty > 0) {
          await db.product_batches.add({
            id: Date.now().toString(),
            productId: prod.id,
            batchNumber: batchNum,
            qty: gQty,
            initialQty: gQty,
            hpp: item.price,
            receivedDate: new Date().toISOString().split('T')[0],
            expiryDate: expDate,
            condition: 'Baik',
            createdAt: new Date().toISOString()
          });

          // Recalculate Weighted Average HPP and update product stock
          const currentBatches = await db.product_batches.where('productId').equals(prod.id).toArray();
          const totalStock = currentBatches.reduce((sum, b) => sum + b.qty, 0);
          const totalValuation = currentBatches.reduce((sum, b) => sum + (b.qty * b.hpp), 0);
          const newHPP = totalStock > 0 ? Math.round(totalValuation / totalStock) : prod.hpp;

          await db.products.update(prod.id, { stock: totalStock, hpp: newHPP });
        }

        if (dQty > 0) {
          // Record damaged batch
          await db.product_batches.add({
            id: (Date.now() + 1).toString(),
            productId: prod.id,
            batchNumber: `${batchNum}-DMG`,
            qty: dQty,
            initialQty: dQty,
            hpp: item.price,
            receivedDate: new Date().toISOString().split('T')[0],
            expiryDate: expDate,
            condition: 'Rusak',
            createdAt: new Date().toISOString()
          });
        }

        await logAudit('Inventory', 'Penerimaan Inbound & Batch', `Menerima PO ${currentPO.poNumber}: Baik (${gQty}), Rusak (${dQty})`);
      });

      alert("Penerimaan barang berhasil diproses dan batch baru telah dibuat!");
      setSelectedPO(''); setGoodQty(''); setDamagedQty(''); setBatchNumber(''); setExpiryDate(''); setNotes('');
    } catch (err) { alert("Error saat memproses inbound."); }
  };

  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
      <div className="p-5 bg-white border-b border-[#E2E8F0]"><h2 className="text-lg font-black text-[#1E293B]">Penerimaan Barang (Inbound & Batch)</h2><p className="text-[10px] font-bold text-[#64748B] mt-1">Barang rusak tidak akan dimasukkan ke stok layak jual.</p></div>
      <form onSubmit={handleInboundReceive} className="p-5 space-y-4">
        <div>
          <label className="block text-[10px] font-black text-[#64748B] mb-1">Pilih PO yang Disetujui</label>
          <select required value={selectedPO} onChange={e=>setSelectedPO(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]">
            <option value="">-- Pilih PO Approved --</option>
            {approvedPOs.map((po:any)=><option key={po.id} value={po.id}>{po.poNumber} - {po.supplier} ({po.items?.[0]?.name}, Qty: {po.items?.[0]?.qty})</option>)}
          </select>
        </div>
        {currentPO && (
          <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-xs font-bold text-[#64748B]">
            Produk: <span className="text-[#1E293B]">{currentPO.items[0].name}</span> | Dipesan: <span className="text-[#DC2626]">{currentPO.items[0].qty}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Jumlah Barang Baik (Layak Jual)</label><input required type="number" min="0" value={goodQty} onChange={e=>setGoodQty(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Jumlah Barang Rusak</label><input type="number" min="0" value={damagedQty} onChange={e=>setDamagedQty(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Nomor Batch</label><input required type="text" placeholder="BATCH-00X" value={batchNumber} onChange={e=>setBatchNumber(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Tanggal Kedaluwarsa</label><input required type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
        </div>
        <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Catatan Penerimaan</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-xs bg-[#F8FAFC]"></textarea></div>
        <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black shadow-md mt-2 text-sm">Simpan Inbound & Buat Batch</button>
      </form>
    </div>
  );
}

function StockOpnameView({ products, stockOpnames, role }: any) {
  const [opnameItems, setOpnameItems] = useState<any[]>([]);
  const [notes, setNotes] = useState('');

  const startOpname = () => {
    const initial = products.map((p: any) => ({
      productId: p.id,
      productName: p.name,
      systemStock: p.stock,
      physicalStock: p.stock,
      variance: 0,
      reason: ''
    }));
    setOpnameItems(initial);
  };

  const handlePhysicalChange = (productId: string, val: string) => {
    const pStock = Number(val);
    setOpnameItems(opnameItems.map(item => {
      if (item.productId === productId) {
        return { ...item, physicalStock: pStock, variance: pStock - item.systemStock };
      }
      return item;
    }));
  };

  const handleReasonChange = (productId: string, val: string) => {
    setOpnameItems(opnameItems.map(item => item.productId === productId ? { ...item, reason: val } : item));
  };

  const submitOpname = async () => {
    try {
      const data = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        status: 'pending',
        items: opnameItems,
        requestedBy: role,
        notes
      };
      await db.stock_opnames.add(data);
      await logAudit(role, 'Pengajuan Stock Opname', 'Mengirim laporan opname fisik ke Pemilik');
      alert("Laporan Stock Opname berhasil diajukan ke Pemilik untuk Berita Acara penyesuaian.");
      setOpnameItems([]); setNotes('');
    } catch (err) { alert("Gagal mengajukan stock opname"); }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {role === 'Inventory' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-black text-base text-[#1E293B]">Formulir Stock Opname Bulanan</h3>
            {opnameItems.length === 0 && <button onClick={startOpname} className="bg-[#DC2626] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md">Mulai Opname Baru</button>}
          </div>

          {opnameItems.length > 0 && (
            <div className="space-y-4">
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8FAFC] text-[#64748B] uppercase font-black sticky top-0">
                    <tr><th className="p-3">Nama Produk</th><th className="p-3">Stok Sistem</th><th className="p-3">Stok Fisik Aktual</th><th className="p-3">Selisih</th><th className="p-3">Alasan Selisih</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] font-bold">
                    {opnameItems.map((item) => (
                      <tr key={item.productId} className="hover:bg-[#F8FAFC]">
                        <td className="p-3">{item.productName}</td>
                        <td className="p-3">{item.systemStock}</td>
                        <td className="p-3"><input type="number" value={item.physicalStock} onChange={e=>handlePhysicalChange(item.productId, e.target.value)} className="w-20 p-1.5 border border-[#E2E8F0] rounded font-bold text-center bg-[#F8FAFC]" /></td>
                        <td className="p-3"><span className={`px-2 py-0.5 rounded ${item.variance===0?'bg-green-100 text-green-700':'bg-red-100 text-[#991B1B]'}`}>{item.variance > 0 ? `+${item.variance}` : item.variance}</span></td>
                        <td className="p-3"><input type="text" placeholder="Keterangan..." value={item.reason} onChange={e=>handleReasonChange(item.productId, e.target.value)} className="w-full p-1.5 border border-[#E2E8F0] rounded font-bold bg-[#F8FAFC]" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Catatan Kesimpulan Opname</label><input type="text" value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-xs bg-[#F8FAFC]" /></div>
              <button onClick={submitOpname} className="w-full bg-[#1E293B] text-white py-3 rounded-xl font-black shadow-md">Ajukan Berita Acara ke Pemilik</button>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0] font-black text-sm">Riwayat Stock Opname & Berita Acara</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[#64748B] uppercase font-black">
            <tr><th className="p-4">Tanggal</th><th className="p-4">Diajukan Oleh</th><th className="p-4">Catatan</th><th className="p-4 text-center">Status Berita Acara</th></tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0] font-bold">
            {stockOpnames.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-[#64748B]">Belum ada riwayat stock opname.</td></tr> : stockOpnames.map((so:any)=>(
              <tr key={so.id} className="hover:bg-[#F8FAFC]">
                <td className="p-4">{formatDate(so.date, true)}</td>
                <td className="p-4">{so.requestedBy}</td>
                <td className="p-4">{so.notes || '-'}</td>
                <td className="p-4 text-center"><span className={`px-2.5 py-1 rounded-md text-[10px] ${so.status==='approved'?'bg-green-100 text-green-700':so.status==='rejected'?'bg-red-100 text-[#991B1B]':'bg-amber-100 text-amber-700'}`}>{so.status.toUpperCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryView({ sales, purchases, role }: any) {
  const [filter, setFilter] = useState('sales');
  
  const requestCancel = async (id: string, receiptNo: string) => {
    if(window.confirm(`Ajukan pembatalan transaksi ${receiptNo}?`)) {
      try {
        await db.sales.update(id, { status: 'cancel_requested' });
        await logAudit(role, 'Pengajuan Batal', `Mengajukan pembatalan transaksi ${receiptNo}`);
        alert("Pengajuan pembatalan berhasil dikirim.");
      } catch(err) { alert("Error menyimpan ke database lokal"); }
    }
  };
  
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-[#E2E8F0] flex gap-2 overflow-x-auto bg-[#F8FAFC]">
        <button onClick={() => setFilter('sales')} className={`px-4 py-2 rounded-lg font-black text-xs whitespace-nowrap ${filter === 'sales' ? 'bg-[#DC2626] text-white shadow-sm' : 'bg-white text-[#64748B] border border-[#E2E8F0]'}`}>Riwayat Penjualan (Kasir)</button>
        {(role === 'Inventory' || role === 'Pemilik') && <button onClick={() => setFilter('purchases')} className={`px-4 py-2 rounded-lg font-black text-xs whitespace-nowrap ${filter === 'purchases' ? 'bg-[#DC2626] text-white shadow-sm' : 'bg-white text-[#64748B] border border-[#E2E8F0]'}`}>Riwayat PO & Inbound</button>}
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left min-w-[600px] border-collapse">
          <thead className="bg-[#F8FAFC] text-[#64748B] text-[10px] font-black uppercase sticky top-0">
            <tr><th className="p-4 border-b">Waktu</th><th className="p-4 border-b">Referensi</th><th className="p-4 border-b">Total (Rp)</th><th className="p-4 border-b text-center">Status</th>{filter === 'sales' && role === 'Kasir' && <th className="p-4 border-b text-center">Aksi</th>}</tr>
          </thead>
          <tbody className="text-xs font-bold text-[#1E293B] divide-y divide-[#E2E8F0]">
            {(filter === 'sales' ? sales : purchases).length === 0 ? (
               <tr><td colSpan={5} className="p-8 text-center text-[#64748B]">Tidak ada data riwayat.</td></tr>
            ) : (filter === 'sales' ? sales : purchases).map((item: any) => (
              <tr key={item.id} className="hover:bg-[#F8FAFC]">
                <td className="p-4 text-[#64748B]">{formatDate(item.date, true)}</td>
                <td className="p-4"><span className="text-[#DC2626] font-black">{item.receiptNumber || item.poNumber}</span></td>
                <td className="p-4">{formatRp(item.total)}</td>
                <td className="p-4 text-center">
                  {item.status === 'completed' || item.status === 'approved' || item.status === 'received' ? <span className="text-green-700 bg-green-100 border border-green-200 px-2 py-1 rounded">Berhasil</span> : 
                   item.status === 'cancelled' || item.status === 'rejected' ? <span className="text-[#DC2626] bg-[#FEE2E2] border border-[#DC2626]/30 px-2 py-1 rounded">Dibatalkan/Ditolak</span> : 
                   item.status === 'cancel_requested' ? <span className="text-[#991B1B] bg-amber-100 border border-amber-300 px-2 py-1 rounded">Menunggu Batal</span> :
                   <span className="text-[#991B1B] bg-amber-100 border border-amber-300 px-2 py-1 rounded">Pending</span>}
                </td>
                {filter === 'sales' && role === 'Kasir' && (
                  <td className="p-4 text-center">
                    {item.status === 'completed' && <button onClick={()=>requestCancel(item.id, item.receiptNumber)} className="bg-[#FEE2E2] text-[#DC2626] hover:bg-[#DC2626] hover:text-white transition px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm">Batalkan</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Approvals({ sales, purchases, adjustments, stockOpnames, role }: any) {
  if (role !== 'Pemilik') return null;
  const pendingCancels = sales.filter((s:any) => s.status === 'cancel_requested');
  const pendingPO = purchases.filter((p:any) => p.status === 'pending');
  const pendingOpname = stockOpnames.filter((so:any) => so.status === 'pending');

  const approve = async (type: string, obj: any, accept: boolean) => {
    try {
      await db.transaction('rw', db.sales, db.purchases, db.stock_opnames, db.products, db.audit_logs, async () => {
        if (type === 'cancel') {
          await db.sales.update(obj.id, { status: accept ? 'cancelled' : 'completed' });
          if(accept) {
            for(const i of obj.items) {
              const p = await db.products.get(i.productId);
              if(p) await db.products.update(p.id, { stock: p.stock + i.qty });
            }
          }
        } else if (type === 'po') {
          await db.purchases.update(obj.id, { status: accept ? 'approved' : 'rejected' });
        } else if (type === 'opname') {
          await db.stock_opnames.update(obj.id, { status: accept ? 'approved' : 'rejected' });
          if (accept) {
            // Apply physical stock adjustments based on opname items
            for (const item of obj.items) {
              if (item.variance !== 0) {
                const prod = await db.products.get(item.productId);
                if (prod) {
                  await db.products.update(prod.id, { stock: item.physicalStock });
                }
              }
            }
          }
        }
        await logAudit('Pemilik', `Approval ${type}`, `Aksi: ${accept ? 'Disetujui' : 'Ditolak'}`);
      });
      alert('Tindakan berhasil disimpan!');
    } catch(err) { alert('Gagal memproses approval.'); }
  };

  const CardList = ({ title, data, type, renderItem }: any) => (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden mb-6">
       <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0] font-black text-[#1E293B] text-sm flex justify-between">{title} <span className="bg-[#DC2626] text-white px-2 py-0.5 rounded-full text-[10px]">{data.length}</span></div>
       <ul className="divide-y divide-[#E2E8F0]">{data.length===0 ? <li className="p-4 text-xs font-bold text-[#64748B]">Tidak ada data pending.</li> : data.map((d:any) => (
         <li key={d.id} className="p-4 flex flex-col md:flex-row justify-between md:items-center gap-4">
           {renderItem(d)}
           <div className="flex gap-2">
              <button onClick={()=>approve(type, d, false)} className="px-4 py-2 bg-[#F8FAFC] hover:bg-[#E2E8F0] border border-[#E2E8F0] text-[#1E293B] rounded-lg font-black text-xs transition">Tolak</button>
              <button onClick={()=>approve(type, d, true)} className="px-4 py-2 bg-[#DC2626] hover:bg-[#991B1B] text-white rounded-lg font-black text-xs shadow-md transition">Setujui</button>
           </div>
         </li>
       ))}</ul>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <CardList title="Pengajuan Batal Transaksi (Kasir)" data={pendingCancels} type="cancel" renderItem={(d:any) => <div className="text-sm font-bold">TRX: {d.receiptNumber} <span className="text-[#DC2626] ml-2 block sm:inline">{formatRp(d.total)}</span><p className="text-[10px] font-bold text-[#64748B] mt-1">{formatDate(d.date, true)}</p></div>} />
      <CardList title="Pengajuan Purchase Order (PO) Gudang" data={pendingPO} type="po" renderItem={(d:any) => <div className="text-sm font-bold">PO: {d.poNumber} (Supplier: {d.supplier})<span className="text-[#64748B] block text-xs mt-1">{d.items[0]?.name} (Qty: {d.items[0]?.qty}) - Total: {formatRp(d.total)}</span></div>} />
      <CardList title="Pengajuan Stock Opname & Berita Acara" data={pendingOpname} type="opname" renderItem={(d:any) => <div className="text-sm font-bold">Opname Tanggal: {formatDate(d.date, true)}<span className="text-[#64748B] block text-xs mt-1">Total Item Diperiksa: {d.items.length} item</span></div>} />
    </div>
  );
}

function CashClosing({ role, sales, cashRegisters }: any) {
  if (role !== 'Kasir') return null;
  const [opening, setOpening] = useState(''); const [physical, setPhysical] = useState('');
  
  const today = new Date().toISOString().split('T')[0];
  const systemCashIn = sales.filter((s:any) => s.status === 'completed' && s.date.startsWith(today) && s.paymentMethod === 'Tunai').reduce((sum:number, s:any) => sum + s.paymentReceived - s.change, 0);
  const isClosed = cashRegisters.some((c:any) => c.date.startsWith(today));
  
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if(isClosed) return;
    try {
      await db.cash_registers.add({ id: Date.now().toString(), date: new Date().toISOString(), openingBalance: Number(opening), systemCashReceived: systemCashIn, expectedCash: Number(opening)+systemCashIn, physicalCash: Number(physical), variance: Number(physical)-(Number(opening)+systemCashIn), status: 'pending_review' });
      await logAudit(role, 'Tutup Kas', 'Kasir menutup laporan kas harian');
      alert('Laporan berhasil disubmit ke Pemilik'); setOpening(''); setPhysical('');
    } catch (err) { alert('Gagal menyimpan.'); }
  };
  
  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
      <div className="flex items-center gap-3 mb-6"><Wallet className="text-[#DC2626]"/><h2 className="text-lg font-black text-[#1E293B]">Tutup Kas Harian</h2></div>
      {isClosed ? <div className="text-center font-bold text-green-700 bg-green-50 border border-green-200 p-4 rounded-xl">Laporan kas hari ini sudah ditutup dan dikirim.</div> : (
        <form onSubmit={submit} className="space-y-5">
          <div><label className="block text-xs font-black text-[#64748B] mb-2 uppercase">Uang Modal Awal (Rp)</label><input required type="number" value={opening} onChange={e=>setOpening(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold bg-[#F8FAFC] focus:border-[#DC2626] outline-none" /></div>
          <div className="p-4 bg-[#FEE2E2] border border-[#DC2626]/30 rounded-xl text-sm font-black text-[#991B1B] flex justify-between items-center shadow-sm"><span>Total Uang Penjualan (Sistem)</span><span className="text-lg">{formatRp(systemCashIn)}</span></div>
          <div><label className="block text-xs font-black text-[#64748B] mb-2 uppercase">Total Uang Fisik di Laci (Rp)</label><input required type="number" value={physical} onChange={e=>setPhysical(e.target.value)} className="w-full p-3 border-2 border-[#DC2626] rounded-xl font-black text-[#DC2626] bg-[#FEE2E2]/20 focus:outline-none" /></div>
          <button type="submit" className="w-full bg-[#1E293B] hover:bg-[#0F172A] text-white py-4 rounded-xl font-black shadow-md transition">Kirim Laporan Tutup Kas</button>
        </form>
      )}
    </div>
  );
}

function CashReconciliation({ cashRegisters, role }: any) {
  if (role !== 'Pemilik') return null;
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden overflow-x-auto h-full flex flex-col">
       <table className="w-full text-left text-sm min-w-[600px]"><thead className="bg-[#F8FAFC] text-[10px] font-black uppercase text-[#64748B] border-b border-[#E2E8F0]"><tr><th className="p-4">Tanggal / Waktu</th><th className="p-4">Total Seharusnya</th><th className="p-4">Fisik Dihitung Kasir</th><th className="p-4">Selisih Uang</th><th className="p-4 text-center">Tindakan</th></tr></thead>
       <tbody className="font-bold divide-y divide-[#E2E8F0]">
         {cashRegisters.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-[#64748B] text-xs">Belum ada laporan tutup kas.</td></tr> : cashRegisters.map((c:any) => (
         <tr key={c.id} className="hover:bg-[#F8FAFC]">
           <td className="p-4 text-[#64748B]">{formatDate(c.date, true)}</td>
           <td className="p-4 text-[#1E293B]">{formatRp(c.expectedCash)}</td>
           <td className="p-4 text-[#1E293B]">{formatRp(c.physicalCash)}</td>
           <td className="p-4">
             <span className={`px-2 py-1 rounded-md text-xs font-black ${c.variance === 0 ? 'bg-green-100 text-green-700' : c.variance < 0 ? 'bg-[#FEE2E2] text-[#DC2626]' : 'bg-blue-100 text-blue-700'}`}>
               {c.variance === 0 ? 'Sesuai' : (c.variance > 0 ? '+ ' : '- ') + formatRp(Math.abs(c.variance))}
             </span>
           </td>
           <td className="p-4 text-center">
             {c.status==='pending_review' ? <button onClick={()=>db.cash_registers.update(c.id, {status:'reviewed'})} className="bg-[#DC2626] text-white px-4 py-2 rounded-xl text-xs shadow-md hover:bg-[#991B1B] transition">Tandai Direview</button> : <span className="text-[#64748B] text-xs"><Check size={16} className="inline mr-1 text-green-600"/>Selesai</span>}
           </td>
         </tr>
       ))}</tbody></table>
    </div>
  )
}

function Expenses({ expenses, role }: any) {
  if (role !== 'Pemilik') return null;
  const [desc, setDesc] = useState(''); const [amount, setAmount] = useState('');
  
  const save = async (e: React.FormEvent) => { 
    e.preventDefault(); 
    await db.expenses.add({id:Date.now().toString(), date:new Date().toISOString(), description:desc, amount:Number(amount)}); 
    await logAudit('Pemilik', 'Biaya Operasional', `Mencatat biaya: ${desc}`);
    setDesc(''); setAmount(''); 
  };
  
  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit">
        <div className="flex items-center gap-3 mb-6"><DollarSign className="text-[#DC2626]"/><h3 className="font-black text-[#1E293B] text-lg">Catat Biaya Baru</h3></div>
        <form onSubmit={save} className="space-y-4">
          <div><label className="block text-xs font-black text-[#64748B] mb-2">Keperluan / Deskripsi</label><input required type="text" placeholder="Misal: Beli Plastik, Listrik..." value={desc} onChange={e=>setDesc(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold bg-[#F8FAFC] focus:border-[#DC2626] outline-none" /></div>
          <div><label className="block text-xs font-black text-[#64748B] mb-2">Jumlah Biaya (Rp)</label><input required type="number" placeholder="Nominal" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold bg-[#F8FAFC] focus:border-[#DC2626] outline-none" /></div>
          <button type="submit" className="w-full bg-[#DC2626] hover:bg-[#991B1B] text-white py-3.5 rounded-xl font-black shadow-md transition">Simpan Pengeluaran</button>
        </form>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
        <h3 className="font-black text-[#1E293B] text-lg mb-6">Riwayat Biaya (Tercatat Lokal)</h3>
        <ul className="space-y-3">
          {expenses.length === 0 ? <li className="text-sm text-[#64748B] text-center p-4">Belum ada pengeluaran.</li> : expenses.map((ex:any) => (
            <li key={ex.id} className="flex flex-col sm:flex-row justify-between sm:items-center font-bold text-sm bg-[#F8FAFC] border border-[#E2E8F0] p-4 rounded-xl gap-2">
              <div><span className="text-[#1E293B]">{ex.description}</span><p className="text-[10px] text-[#64748B] mt-1">{formatDate(ex.date, true)}</p></div>
              <span className="text-[#DC2626] bg-[#FEE2E2] px-3 py-1.5 rounded-lg border border-[#FEE2E2] text-right">{formatRp(ex.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function AuditTrail({ logs, role }: any) {
  if (role !== 'Pemilik') return null;
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm h-[calc(100vh-10rem)] flex flex-col overflow-hidden">
       <div className="p-4 bg-white border-b border-[#E2E8F0]"><h3 className="font-black text-[#1E293B] flex items-center gap-2"><Search size={18} className="text-[#DC2626]"/> Riwayat Aktivitas Sistem</h3></div>
       <div className="flex-1 overflow-auto custom-scrollbar">
         <table className="w-full text-left text-xs min-w-[500px] border-collapse"><thead className="bg-[#F8FAFC] text-[10px] font-black uppercase text-[#64748B] sticky top-0 border-b border-[#E2E8F0]"><tr><th className="p-4">Waktu Terjadi</th><th className="p-4">Peran (Role)</th><th className="p-4">Aktivitas / Detail</th></tr></thead>
         <tbody className="font-bold divide-y divide-[#E2E8F0]">
           {logs.length === 0 ? <tr><td colSpan={3} className="p-8 text-center text-[#64748B]">Tidak ada rekam jejak.</td></tr> : logs.map((l:any) => (
           <tr key={l.id} className="hover:bg-[#F8FAFC]">
             <td className="p-4 text-[#64748B] font-mono">{new Date(l.timestamp).toLocaleString('id-ID')}</td>
             <td className="p-4"><span className="bg-[#1E293B] text-white px-2 py-1 rounded text-[10px]">{l.role}</span></td>
             <td className="p-4 text-[#1E293B]">{l.action}: <span className="text-[#64748B] font-normal ml-1">{l.details}</span></td>
           </tr>
         ))}</tbody></table>
       </div>
    </div>
  )
}

function Reports({ products, sales, role }: any) {
  if (role !== 'Pemilik') return null;
  const handleExport = async () => {
    const fSales = sales.filter((s: any) => s.status === 'completed');
    const wb = XLSX.utils.book_new();
    const summary = [
      ["POS LOKAL OFFLINE - LAPORAN KEUANGAN"],
      [],
      ["Total Transaksi Sukses", fSales.length],
      ["Total Omzet/Pemasukan", fSales.reduce((s: any,x: any)=>s+x.total,0)], 
      ["Total Keuntungan/Laba", fSales.reduce((s: any,x: any)=>s+x.profit,0)]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Ringkasan Laporan");
    XLSX.writeFile(wb, `Laporan_Keuangan_Offline_${new Date().toISOString().split('T')[0]}.xlsx`);
  };
  return (
    <div className="max-w-md mx-auto text-center mt-12 bg-white p-8 rounded-2xl shadow-sm border border-[#E2E8F0]">
      <FileSpreadsheet size={48} className="mx-auto text-[#DC2626] mb-4"/>
      <h2 className="text-xl font-black mb-2 text-[#1E293B]">Laporan Keuangan</h2>
      <p className="text-[#64748B] text-sm font-bold mb-8">Data ditarik secara offline dari memory perangkat ini ke format Excel.</p>
      <button onClick={handleExport} className="w-full bg-[#1E293B] hover:bg-[#0F172A] text-white py-4 rounded-xl font-black shadow-md transition flex items-center justify-center gap-2">
        <Download size={18}/> Unduh File Excel (.xlsx)
      </button>
    </div>
  )
}

function SettingsView({ role }: any) {
  if (role !== 'Pemilik') return null;
  const handleBackup = async () => {
    const data = { products: await db.products.toArray(), batches: await db.product_batches.toArray(), sales: await db.sales.toArray(), purchases: await db.purchases.toArray(), expenses: await db.expenses.toArray(), adjustments: await db.adjustments.toArray(), stock_opnames: await db.stock_opnames.toArray(), cash_registers: await db.cash_registers.toArray(), audit_logs: await db.audit_logs.toArray(), settings: await db.settings.toArray() };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `Backup_POS_${new Date().toISOString().split('T')[0]}.json`; link.click();
  };

  const handleRestore = async (e: any) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if(!window.confirm("PERINGATAN: Restore akan MENIMPA semua data lokal saat ini! Lanjutkan?")) return;
        await db.transaction('rw', db.products, db.product_batches, db.sales, db.purchases, db.expenses, db.adjustments, db.stock_opnames, db.cash_registers, db.audit_logs, db.settings, async () => {
          await db.products.clear(); if(data.products) await db.products.bulkAdd(data.products);
          await db.product_batches.clear(); if(data.batches) await db.product_batches.bulkAdd(data.batches);
          await db.sales.clear(); if(data.sales) await db.sales.bulkAdd(data.sales);
          await db.purchases.clear(); if(data.purchases) await db.purchases.bulkAdd(data.purchases);
          await db.expenses.clear(); if(data.expenses) await db.expenses.bulkAdd(data.expenses);
          await db.adjustments.clear(); if(data.adjustments) await db.adjustments.bulkAdd(data.adjustments);
          await db.stock_opnames.clear(); if(data.stock_opnames) await db.stock_opnames.bulkAdd(data.stock_opnames);
          await db.cash_registers.clear(); if(data.cash_registers) await db.cash_registers.bulkAdd(data.cash_registers);
          await db.audit_logs.clear(); if(data.audit_logs) await db.audit_logs.bulkAdd(data.audit_logs);
          await db.settings.clear(); if(data.settings) await db.settings.bulkAdd(data.settings);
        });
        alert("Restore Berhasil! Halaman akan dimuat ulang."); window.location.reload();
      } catch(err) { alert("File backup rusak atau tidak valid!"); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
        <h2 className="font-black text-lg mb-2 text-[#1E293B] flex items-center gap-2"><Database className="text-[#DC2626]"/> Backup & Restore Data Lokal</h2>
        <p className="text-[#64748B] text-xs font-bold mb-6">Amankan data aplikasi Anda dengan mengunduhnya secara rutin ke bentuk file JSON.</p>
        
        <div className="grid md:grid-cols-2 gap-4">
          <button onClick={handleBackup} className="p-5 bg-[#F8FAFC] border-2 border-[#E2E8F0] rounded-xl text-left hover:border-[#DC2626] hover:bg-white transition group cursor-pointer shadow-sm">
            <Download size={28} className="mb-3 text-[#64748B] group-hover:text-[#DC2626] transition"/> 
            <h4 className="font-black text-[#1E293B]">Export (Backup) Data</h4>
            <p className="text-[10px] text-[#64748B] font-bold mt-1">Unduh seluruh database ke JSON</p>
          </button>
          
          <label className="p-5 bg-[#F8FAFC] border-2 border-[#E2E8F0] rounded-xl text-left hover:border-[#DC2626] hover:bg-white transition group cursor-pointer shadow-sm">
            <Upload size={28} className="mb-3 text-[#64748B] group-hover:text-[#DC2626] transition"/> 
            <h4 className="font-black text-[#1E293B]">Import (Restore) Data</h4>
            <p className="text-[10px] text-[#64748B] font-bold mt-1">Pulihkan data dari file JSON</p>
            <input type="file" accept=".json" onChange={handleRestore} className="hidden"/>
          </label>
        </div>
      </div>
    </div>
  )
}