import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Dexie, { Table } from 'dexie';
import * as XLSX from 'xlsx';
import { 
  LayoutDashboard, ShoppingCart, Package, ArrowDownToLine, 
  History, DollarSign, FileSpreadsheet, Settings, 
  Plus, Minus, Trash2, Search, Check, X, 
  LogOut, UserCircle, Receipt, Printer, AlertTriangle,
  Eye, EyeOff, ShieldCheck, ClipboardCheck, Wallet, Lock, Menu, Database, Download, Upload, ClipboardList,
  Users, CreditCard, Banknote, Sliders, Image as ImageIcon, ArchiveRestore, Archive,
  Wifi, WifiOff, Cloud, CloudOff, RefreshCw
} from 'lucide-react';
import { supabase } from './supabaseClient';

// ==================== DATABASE SCHEMA (Dexie Lokal) ====================
export interface SyncQueueItem {
  id: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  table_name: string;
  payload: any;
  created_at: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  hpp: number;
  price: number;
  memberPrice: number;
  stock: number;
  minStock: number;
  isArchived?: boolean;
}

export interface ProductBatch {
  id: string;
  productId: string;
  batchNumber: string;
  qty: number;
  initialQty: number;
  hpp: number;
  receivedDate: string;
  expiryDate: string;
  condition: 'Baik' | 'Rusak' | 'Kedaluwarsa';
  createdAt?: string;
}

export interface MinStockSetting {
  id: string;
  type: 'global' | 'product';
  periodDays: number;
  percentage: number;
  leadTimeDays: number;
  safetyStock: number;
  calculationMethod: 'percentage' | 'lead_time';
}

export class POSDatabase extends Dexie {
  products!: Table<Product>;
  product_batches!: Table<ProductBatch>;
  sales!: Table<any>;
  purchases!: Table<any>;
  expenses!: Table<any>;
  adjustments!: Table<any>;
  stock_opnames!: Table<any>;
  cash_registers!: Table<any>;
  audit_logs!: Table<any>;
  settings!: Table<any>;
  members!: Table<any>;
  shifts!: Table<any>;
  min_stock_settings!: Table<MinStockSetting>;
  sync_queue!: Table<SyncQueueItem>;

  constructor() {
    super('KoperasiPOSDB');
    this.version(4).stores({
      products: 'id, sku, name, category, isArchived, sync_status',
      product_batches: 'id, productId, batchNumber, condition, expiryDate, sync_status',
      sales: 'id, receiptNumber, date, status, shiftId, memberId, sync_status',
      purchases: 'id, poNumber, date, status, sync_status',
      expenses: 'id, date, sync_status',
      adjustments: 'id, date, sync_status',
      stock_opnames: 'id, date, status, sync_status',
      cash_registers: 'id, sync_status',
      audit_logs: 'id, timestamp, role, sync_status',
      settings: 'id',
      members: 'id, noInduk, name, status, sync_status',
      shifts: 'id, shiftNumber, status, startTime, endTime, sync_status',
      min_stock_settings: 'id, type',
      sync_queue: 'id, table_name, operation, created_at'
    });
  }
}
export const db = new POSDatabase();

// ==================== UTILITIES ====================
const formatRp = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount || 0);
const formatDate = (dateString: string, includeTime = false) => {
  if (!dateString) return '-';
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  if (includeTime) { options.hour = '2-digit'; options.minute = '2-digit'; }
  return new Date(dateString).toLocaleDateString('id-ID', options);
};
const generateReceiptNumber = () => `TRX-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
const generatePONumber = () => `PO-${Date.now().toString().slice(-6)}`;
const generateId = (prefix: string) => `${prefix}-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// ==================== SYNC ENGINE (OFFLINE-FIRST) ====================
let isSyncingProcess = false;

export const enqueueSync = async (operation: 'INSERT'|'UPDATE'|'DELETE', table_name: string, payload: any) => {
  await db.sync_queue.add({ id: generateUUID(), operation, table_name, payload, created_at: new Date().toISOString() });
  triggerPushSync();
};

export const triggerPushSync = async () => {
  if (!navigator.onLine || isSyncingProcess) return;
  isSyncingProcess = true;
  try {
    const queue = await db.sync_queue.orderBy('created_at').toArray();
    if (queue.length === 0) return;

    for (const item of queue) {
      try {
        let success = false;
        if (item.table_name === 'sales' && item.operation === 'INSERT') {
          const { error } = await supabase.rpc('process_sale_sync', { p_sale: item.payload, p_items: item.payload.items });
          if (!error) success = true; else console.error('Sales Sync Error:', error);
        } else if (item.table_name === 'purchases' && item.operation === 'INSERT') {
          const { items, ...poData } = item.payload;
          const { error } = await supabase.from('purchases').insert(poData);
          if (!error || error.code === '23505') {
            if (items && items.length > 0) {
              const poItems = items.map((i:any) => ({ purchase_id: poData.id, product_id: i.productId, name: i.name, qty: i.qty, price: i.price, total: i.total }));
              await supabase.from('purchase_items').insert(poItems);
            }
            success = true;
          }
        } else if (item.table_name === 'stock_opnames' && item.operation === 'INSERT') {
          const { items, ...opnameData } = item.payload;
          const { error } = await supabase.from('stock_opnames').insert(opnameData);
          if (!error || error.code === '23505') {
            if (items && items.length > 0) {
              const opItems = items.map((i:any) => ({ opname_id: opnameData.id, product_id: i.productId, product_name: i.productName, system_stock: i.systemStock, physical_stock: i.physicalStock, variance: i.variance, reason: i.reason }));
              await supabase.from('stock_opname_items').insert(opItems);
            }
            success = true;
          }
        } else {
          if (item.operation === 'INSERT') {
            const { error } = await supabase.from(item.table_name).insert(item.payload);
            if (!error || error.code === '23505') success = true; 
          } else if (item.operation === 'UPDATE') {
            const { error } = await supabase.from(item.table_name).update(item.payload).eq('id', item.payload.id);
            if (!error) success = true;
          } else if (item.operation === 'DELETE') {
            const { error } = await supabase.from(item.table_name).delete().eq('id', item.payload.id);
            if (!error) success = true;
          }
        }
        if (success) await db.sync_queue.delete(item.id);
      } catch (err) { console.error(`Sync error on ${item.table_name}:`, err); }
    }
  } finally { isSyncingProcess = false; }
};

export const startRealtimeSync = () => {
  const tables = ['products', 'product_batches', 'members', 'expenses', 'purchases', 'sales', 'shifts', 'stock_opnames', 'audit_logs'];
  tables.forEach(table => {
    supabase.channel(`public:${table}`).on('postgres_changes', { event: '*', schema: 'public', table: table }, async (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const data = payload.new as any;
        if (table === 'products') await db.products.put(data);
        if (table === 'product_batches') await db.product_batches.put(data);
        if (table === 'members') await db.members.put(data);
        if (table === 'expenses') await db.expenses.put(data);
        if (table === 'shifts') await db.shifts.put(data);
        if (table === 'audit_logs') await db.audit_logs.put(data);
        if (table === 'purchases') await db.purchases.put(data);
        if (table === 'sales') await db.sales.put(data);
        if (table === 'stock_opnames') await db.stock_opnames.put(data);
      }
    }).subscribe();
  });
};

const logAudit = async (role: string, action: string, details: string) => {
  const payload = { id: generateUUID(), timestamp: new Date().toISOString(), role, action, details };
  await db.audit_logs.add(payload);
  await enqueueSync('INSERT', 'audit_logs', payload);
};

export const calculateProductStats = async (productId: string, settings: MinStockSetting) => {
  const periodMs = settings.periodDays * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - periodMs).toISOString();
  const allSales = await db.sales.where('date').aboveOrEqual(cutoffDate).toArray();
  const validSales = allSales.filter(s => s.status === 'completed');
  let totalUnitsSold = 0;
  validSales.forEach(sale => { const item = sale.items?.find((i: any) => i.productId === productId); if (item) totalUnitsSold += item.qty; });
  const dailyAverage = totalUnitsSold / settings.periodDays;
  let minStock = 0;
  if (settings.calculationMethod === 'percentage') minStock = Math.ceil(dailyAverage * settings.periodDays * (settings.percentage / 100));
  else minStock = Math.ceil((dailyAverage * settings.leadTimeDays) + settings.safetyStock);

  const today = new Date().toISOString().split('T')[0];
  const batches = await db.product_batches.where('productId').equals(productId).toArray();
  const sellableStock = batches.filter(b => b.condition === 'Baik' && b.expiryDate >= today).reduce((sum, b) => sum + b.qty, 0);

  const pendingPurchases = await db.purchases.filter(p => p.status === 'approved').toArray();
  let stockInTransit = 0;
  pendingPurchases.forEach(po => { const item = po.items?.find((i: any) => i.productId === productId); if (item) stockInTransit += item.qty; });

  let status = 'Data Belum Mencukupi';
  if (totalUnitsSold > 0) {
      if (sellableStock <= 0) status = 'Di Bawah Stok Minimum'; else if (sellableStock < minStock) status = 'Di Bawah Stok Minimum';
      else if (sellableStock === minStock) status = 'Stok Minimum Tercapai'; else if (sellableStock <= minStock * 1.2) status = 'Mendekati Stok Minimum';
      else status = 'Aman';
  }
  const targetStock = minStock > 0 ? (minStock * 2) : 10;
  const recommendedOrder = Math.max(0, targetStock - sellableStock - stockInTransit);
  return { totalUnitsSold, dailyAverage, minStock, sellableStock, stockInTransit, status, recommendedOrder, calculationMethod: settings.calculationMethod };
};

export default function App() {
  const [loggedInRole, setLoggedInRole] = useState<string | null>(null);
  const [loggedInName, setLoggedInName] = useState<string | null>(null);
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncItemsCount, setSyncItemsCount] = useState(0);

  const products = useLiveQuery(() => db.products.toArray(), []) || [];
  const batches = useLiveQuery(() => db.product_batches.toArray(), []) || [];
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().toArray(), []) || [];
  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().toArray(), []) || [];
  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), []) || [];
  const adjustments = useLiveQuery(() => db.adjustments.orderBy('date').reverse().toArray(), []) || [];
  const stockOpnames = useLiveQuery(() => db.stock_opnames.orderBy('date').reverse().toArray(), []) || [];
  const auditLogs = useLiveQuery(() => db.audit_logs.orderBy('timestamp').reverse().toArray(), []) || [];
  const members = useLiveQuery(() => db.members.toArray(), []) || [];
  const shifts = useLiveQuery(() => db.shifts.orderBy('startTime').reverse().toArray(), []) || [];
  
  const globalMinStockSettingRaw = useLiveQuery(() => db.min_stock_settings.get('global'), []);
  const appLogoRaw = useLiveQuery(() => db.settings.get('appLogo'), []);
  const appLogoUrl = appLogoRaw?.value || null;
  
  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const localProfile = await db.settings.get('local_profile');
        if (localProfile?.value) {
          setLoggedInRole(localProfile.value.role);
          setLoggedInName(localProfile.value.full_name);
          setLoggedInUserId(session.user.id);
        }
      }
      setIsInitializing(false);
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setLoggedInRole(null); setLoggedInName(null); setLoggedInUserId(null);
        await db.settings.delete('local_profile');
      }
    });

    const seedSettings = async () => {
      const count = await db.min_stock_settings.count();
      if (count === 0) await db.min_stock_settings.put({ id: 'global', type: 'global', periodDays: 30, percentage: 50, leadTimeDays: 3, safetyStock: 10, calculationMethod: 'percentage' });
    };
    seedSettings();

    const handleOnline = () => { setIsOnline(true); triggerPushSync(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline);

    const interval = setInterval(async () => {
       const count = await db.sync_queue.count();
       setSyncItemsCount(count);
    }, 2500);

    return () => { subscription.unsubscribe(); window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); clearInterval(interval); }
  }, []);

  useEffect(() => {
    if (loggedInRole && isOnline) {
      startRealtimeSync();
      triggerPushSync();
    }
  }, [loggedInRole, isOnline]);

  if (isInitializing) return <div className="flex h-screen items-center justify-center bg-[#F8FAFC] text-red-800 font-bold">Menghubungkan ke Sistem Keamanan Cloud...</div>;
  
  const globalMinStockSetting = globalMinStockSettingRaw || { id: 'global', type: 'global', periodDays: 30, percentage: 50, leadTimeDays: 3, safetyStock: 10, calculationMethod: 'percentage' };

  if (!loggedInRole) return <LoginScreen appLogoUrl={appLogoUrl} onLogin={(role: any, name: string, userId: string) => { setLoggedInRole(role); setLoggedInName(name); setLoggedInUserId(userId); setActiveTab('dashboard'); logAudit(role, 'Login', `Berhasil masuk: ${name}`); }} />;

  const handleLogout = async () => { 
    if (loggedInRole) await logAudit(loggedInRole, 'Logout', 'Keluar dari sistem'); 
    await supabase.auth.signOut();
  };
  const activeShift = shifts.find((s:any) => s.status === 'open');

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Kasir', 'Inventory', 'Admin'] },
    { id: 'pos', label: 'Kasir & Transaksi', icon: ShoppingCart, roles: ['Kasir'] },
    { id: 'members', label: 'Data Anggota', icon: Users, roles: ['Admin'] },
    { id: 'shift_management', label: 'Tutup Kas Harian', icon: Wallet, roles: ['Kasir'] },
    { id: 'products', label: 'Data Persediaan', icon: Package, roles: ['Inventory', 'Admin'] },
    { id: 'min_stock_settings', label: 'Pengaturan Stok Min', icon: Sliders, roles: ['Admin', 'Inventory'] },
    { id: 'purchase_orders', label: 'Purchase Order (PO)', icon: ClipboardList, roles: ['Inventory', 'Admin'] },
    { id: 'inbound', label: 'Penerimaan Barang', icon: ArrowDownToLine, roles: ['Inventory'] },
    { id: 'stock_opname', label: 'Stock Opname', icon: ClipboardCheck, roles: ['Inventory', 'Admin'] },
    { id: 'history', label: 'Riwayat Transaksi', icon: History, roles: ['Kasir', 'Inventory', 'Admin'] },
    { id: 'approvals', label: 'Persetujuan (Admin)', icon: ShieldCheck, roles: ['Admin'] },
    { id: 'expenses', label: 'Biaya Operasional', icon: DollarSign, roles: ['Admin'] },
    { id: 'reports', label: 'Laporan & Excel', icon: FileSpreadsheet, roles: ['Admin'] },
    { id: 'audit', label: 'Jejak Audit', icon: Search, roles: ['Admin'] },
    { id: 'settings', label: 'Pengaturan Sistem', icon: Settings, roles: ['Admin'] },
  ];

  const pendingApprovalsCount = sales.filter((s:any) => s.status === 'cancel_requested').length + purchases.filter((p:any) => p.status === 'pending').length + stockOpnames.filter((so:any) => so.status === 'pending').length + shifts.filter((s:any) => s.status === 'pending_verification').length;

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard products={products} batches={batches} sales={sales} role={loggedInRole} purchases={purchases} shifts={shifts} stockOpnames={stockOpnames} members={members} globalMinStockSetting={globalMinStockSetting} />;
      case 'pos': return activeShift ? <POS products={products} batches={batches} role={loggedInRole} members={members} activeShift={activeShift} appLogoUrl={appLogoUrl} loggedInUserId={loggedInUserId} /> : <OpenShift role={loggedInRole} loggedInUserId={loggedInUserId} />;
      case 'members': return <Members members={members} role={loggedInRole} />;
      case 'shift_management': return <CloseShift role={loggedInRole} sales={sales} activeShift={activeShift} expenses={expenses} />;
      case 'products': return <Products products={products} batches={batches} role={loggedInRole} />;
      case 'min_stock_settings': return <MinStockSettingsView globalSetting={globalMinStockSetting} role={loggedInRole} />;
      case 'purchase_orders': return <PurchaseOrders products={products} purchases={purchases} role={loggedInRole} loggedInUserId={loggedInUserId} />;
      case 'inbound': return <Inbound products={products} purchases={purchases} role={loggedInRole} />;
      case 'stock_opname': return <StockOpnameView products={products} stockOpnames={stockOpnames} role={loggedInRole} loggedInUserId={loggedInUserId} />;
      case 'history': return <HistoryView sales={sales} purchases={purchases} role={loggedInRole} />;
      case 'approvals': return <Approvals sales={sales} purchases={purchases} adjustments={adjustments} stockOpnames={stockOpnames} shifts={shifts} products={products} role={loggedInRole} />;
      case 'expenses': return <Expenses expenses={expenses} role={loggedInRole} loggedInUserId={loggedInUserId} />;
      case 'reports': return <Reports products={products} sales={sales} expenses={expenses} role={loggedInRole} />;
      case 'audit': return <AuditTrail logs={auditLogs} role={loggedInRole} />;
      case 'settings': return <SettingsView role={loggedInRole} appLogoUrl={appLogoUrl} />;
      default: return <Dashboard products={products} batches={batches} sales={sales} role={loggedInRole} purchases={purchases} shifts={shifts} stockOpnames={stockOpnames} members={members} globalMinStockSetting={globalMinStockSetting} />;
    }
  };

  return (
    <div className="flex h-[100dvh] bg-[#F8FAFC] font-sans overflow-hidden text-[#1E293B]">
      <header className="lg:hidden absolute top-0 left-0 w-full h-16 bg-[#991B1B] text-white p-4 flex justify-between items-center z-40 shadow-md">
        <div className="flex items-center gap-2 font-bold text-lg tracking-wide">
          {appLogoUrl ? <img src={appLogoUrl} alt="Logo" className="h-6 w-6 rounded-full bg-white object-cover" /> : <Lock size={18}/>} Gerai KMP PKT
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2"><Menu size={24}/></button>
      </header>

      {isMobileMenuOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

      <div className={`fixed inset-y-0 left-0 w-64 bg-[#991B1B] text-white flex flex-col shadow-2xl z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300`}>
        <div className="p-6 bg-[#7F1D1D] border-b border-[#7F1D1D] flex flex-col justify-center min-h-[80px] lg:min-h-[100px] relative">
          <div className="flex items-center gap-3">
            {appLogoUrl ? <img src={appLogoUrl} alt="Logo" className="h-10 w-10 rounded-full border-2 border-white object-cover bg-white" /> : <Lock size={28} className="text-white" />}
            <div><h1 className="text-lg lg:text-xl font-bold tracking-wide leading-tight">GERAI<br/>KMP PKT</h1></div>
          </div>
          <button className="absolute top-4 right-4 lg:hidden text-[#FEE2E2] hover:text-white" onClick={() => setIsMobileMenuOpen(false)}><X size={24}/></button>
        </div>
        
        <div className="p-4 bg-[#7F1D1D]/50 border-b border-[#7F1D1D]">
          <div className="flex items-center gap-3"><UserCircle size={32} className="text-[#FEE2E2]" /><div><p className="text-[10px] text-[#FEE2E2]">Masuk sebagai</p><p className="font-bold text-white tracking-wide text-sm">{loggedInName} ({loggedInRole})</p></div></div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {navItems.filter(item => loggedInRole && item.roles.includes(loggedInRole)).map(item => {
            const isActive = activeTab === item.id;
            let badge = null;
            if (item.id === 'approvals' && pendingApprovalsCount > 0) badge = pendingApprovalsCount;
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
          <div className="flex items-center gap-4">
             <h2 className="text-lg font-bold text-[#1E293B]">{navItems.find(i => i.id === activeTab)?.label}</h2>
             <div className="flex items-center gap-3 border-l border-[#E2E8F0] pl-4">
                {isOnline ? ( <div className="flex items-center gap-1.5 text-[10px] font-black text-green-700 bg-green-50 px-2.5 py-1 rounded border border-green-200 uppercase tracking-widest"><Wifi size={14} /> Terhubung Cloud</div> ) : ( <div className="flex items-center gap-1.5 text-[10px] font-black text-[#991B1B] bg-[#FEE2E2] px-2.5 py-1 rounded border border-[#991B1B] uppercase tracking-widest"><WifiOff size={14} /> Offline Mode</div> )}
                {syncItemsCount > 0 ? ( <button onClick={triggerPushSync} className="flex items-center gap-1.5 text-[10px] font-black text-amber-700 bg-amber-50 hover:bg-amber-100 transition px-2.5 py-1 rounded border border-amber-300 uppercase tracking-widest cursor-pointer shadow-sm"><RefreshCw size={12} className="animate-spin"/> {syncItemsCount} Antrean Sync</button> ) : ( isOnline && <div className="flex items-center gap-1.5 text-[10px] font-black text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-200 uppercase tracking-widest"><Cloud size={14} /> Tersinkronisasi</div> )}
             </div>
          </div>
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

function LoginScreen({ onLogin, appLogoUrl }: any) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false); const [error, setError] = useState(''); const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setIsLoading(true);
    try {
      if (!navigator.onLine) throw new Error("Anda sedang offline. Koneksi internet diperlukan untuk login pertama kali.");
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;

      const { data: profile, error: profileError } = await supabase.from('users').select('*').eq('id', data.user.id).single();
      if (profileError || !profile) throw new Error("Gagal memuat profil. Akun Anda mungkin tidak memiliki izin RLS.");
      if (!profile.is_active) throw new Error("Akses Ditolak. Akun dinonaktifkan oleh Admin.");

      await db.settings.put({ id: 'local_profile', value: profile });
      onLogin(profile.role, profile.full_name, data.user.id);
    } catch (err: any) { setError(err.message || 'Gagal masuk. Periksa kembali email dan password Anda.'); } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border-t-8 border-[#DC2626]">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-[#FEE2E2] text-[#DC2626] rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm overflow-hidden border-4 border-white">
            {appLogoUrl ? <img src={appLogoUrl} alt="Logo Koperasi" className="w-full h-full object-cover" /> : <Lock size={32} />}
          </div>
          <h2 className="text-2xl font-black text-[#1E293B]">GERAI KMP PKT</h2>
          <p className="text-[#64748B] text-xs font-bold mt-2 uppercase tracking-widest">Sistem POS & Inventory Cloud</p>
        </div>
        {error && <div className="bg-[#FEE2E2] text-[#991B1B] p-3 rounded-lg text-sm font-bold mb-6 text-center border border-[#991B1B] flex items-center justify-center gap-2"><AlertTriangle size={16}/> {error}</div>}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#64748B] mb-2 uppercase">Email Pengguna</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@koperasi.com" required className="w-full border-2 border-[#E2E8F0] rounded-xl p-3 focus:outline-none focus:border-[#DC2626] bg-white font-bold text-[#1E293B] text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#64748B] mb-2 uppercase">Password</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan password" required className="w-full border-2 border-[#E2E8F0] rounded-xl p-3 pr-12 focus:outline-none focus:border-[#DC2626] font-bold text-[#1E293B] text-sm" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-[#64748B] hover:text-[#DC2626]">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>
            </div>
          </div>
          <button type="submit" disabled={isLoading} className="w-full bg-[#DC2626] hover:bg-[#991B1B] disabled:bg-slate-400 text-white py-3.5 rounded-xl font-bold shadow-lg transition-all flex justify-center items-center gap-2 text-sm mt-2">
            {isLoading ? 'Memverifikasi...' : 'Login Ke Sistem'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ products, batches, sales, role, purchases, shifts, stockOpnames, members, globalMinStockSetting }: any) {
  const [analyticsData, setAnalyticsData] = useState<any[]>([]);
  const activeProducts = products.filter((p: any) => !p.isArchived);

  useEffect(() => {
    if (role === 'Inventory' || role === 'Admin') {
      const loadAnalytics = async () => {
        const stats = await Promise.all(
          activeProducts.map(async (p: any) => { const stat = await calculateProductStats(p.id, globalMinStockSetting); return { ...p, ...stat }; })
        );
        setAnalyticsData(stats);
      };
      loadAnalytics();
    }
  }, [activeProducts, sales, batches, purchases, globalMinStockSetting, role]);

  const completedSales = sales.filter((s: any) => s.status === 'completed');
  const today = new Date().toISOString().split('T')[0];
  const todaySales = completedSales.filter((s: any) => s.date.startsWith(today));
  const kasirTotalSales = todaySales.reduce((sum: number, s: any) => sum + s.total, 0);
  const totalStock = activeProducts.reduce((sum: number, p: any) => sum + p.stock, 0);
  const activeShift = shifts.find((s:any) => s.status === 'open');
  
  const lowStockProducts = role === 'Kasir' 
    ? activeProducts.filter((p: any) => p.stock <= (p.minStock ?? 10))
    : analyticsData.filter(a => a.status === 'Di Bawah Stok Minimum' || a.status === 'Mendekati Stok Minimum' || a.status === 'Stok Minimum Tercapai');
    
  const outOfStockProducts = role === 'Kasir'
    ? activeProducts.filter((p: any) => p.stock === 0)
    : analyticsData.filter(a => a.sellableStock === 0);
  
  const thirtyDaysFromNow = new Date(); thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const nearExpiryBatches = batches.filter((b: any) => b.qty > 0 && new Date(b.expiryDate) <= thirtyDaysFromNow);
  const pendingPO = purchases.filter((p: any) => p.status === 'pending').length;
  const pendingOpname = stockOpnames.filter((so: any) => so.status === 'pending').length;
  const pendingShiftsCount = shifts.filter((c: any) => c.status === 'pending_verification').length;

  const StatCard = ({ title, value, sub, icon: Icon, alertClass }: any) => (
    <div className={`bg-white rounded-2xl shadow-sm p-5 border ${alertClass || 'border-[#E2E8F0]'} flex items-center space-x-4`}>
      <div className={`p-4 rounded-xl bg-[#FEE2E2] text-[#DC2626]`}><Icon size={24} /></div>
      <div><p className="text-[10px] text-[#64748B] font-bold tracking-wider uppercase">{title}</p><h3 className="text-xl lg:text-2xl font-black text-[#1E293B] mt-1">{value}</h3>{sub && <p className="text-[10px] text-[#64748B] mt-1 font-bold">{sub}</p>}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {role === 'Kasir' && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard title="Status Shift" value={activeShift ? `Aktif (${activeShift.shiftNumber})` : 'Belum Buka Shift'} icon={activeShift ? Wallet : AlertTriangle} alertClass={activeShift ? 'border-green-400 bg-green-50/20' : 'border-red-400 bg-red-50/20'} />
        <StatCard title="Total Transaksi" value={todaySales.length} sub="Transaksi berhasil hari ini" icon={Receipt} />
      </div>}
      
      {(role === 'Inventory' || role === 'Admin') && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard title="Total Item Stok Aktif" value={`${totalStock} Unit`} icon={Package} />
            <StatCard title="Perlu Perhatian Stok" value={lowStockProducts.length} sub="Menyentuh/di bawah minimum" icon={AlertTriangle} alertClass="border-amber-400 bg-amber-50/20" />
            <StatCard title="Mendekati Kedaluwarsa" value={nearExpiryBatches.length} sub="< 30 hari ke depan" icon={AlertTriangle} alertClass="border-red-400 bg-red-50/20" />
            <StatCard title="PO Pending" value={pendingPO} sub="Menunggu approval Admin" icon={ClipboardList} />
            <StatCard title="Stok Habis" value={outOfStockProducts.length} sub="Perlu pengadaan segera" icon={Package} alertClass="border-red-400 bg-red-50/20" />
            <StatCard title="Opname Pending" value={pendingOpname} sub="Menunggu review Admin" icon={ClipboardCheck} />
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="p-4 bg-white border-b border-[#E2E8F0] flex justify-between items-center">
              <h3 className="font-black text-base text-[#1E293B] flex items-center gap-2"><Sliders className="text-[#DC2626]" size={18}/> Analitik Stok Minimum (Auto-Reorder)</h3>
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">Berdasarkan {globalMinStockSetting.periodDays} Hari Penjualan</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-[#F8FAFC] text-[#64748B] uppercase font-black text-[10px]">
                  <tr><th className="p-4">SKU & Nama Barang</th><th className="p-4 text-center">Unit Terjual<br/><span className="lowercase text-[9px]">({globalMinStockSetting.periodDays}hr)</span></th><th className="p-4 text-center">Avg Harian</th><th className="p-4 text-center">Stok Min<br/><span className="lowercase text-[9px]">(Tgt)</span></th><th className="p-4 text-center">Stok Layak<br/><span className="lowercase text-[9px]">(Aktual)</span></th><th className="p-4 text-center">PO Disetujui<br/><span className="lowercase text-[9px]">(OTW)</span></th><th className="p-4 text-center">Status</th><th className="p-4 text-center">Rekomendasi<br/><span className="lowercase text-[9px]">(Order)</span></th></tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-bold text-[#1E293B]">
                  {analyticsData.map((a: any) => {
                    let statusColor = 'bg-slate-100 text-slate-700';
                    if (a.status === 'Aman') statusColor = 'bg-green-100 text-green-700'; else if (a.status === 'Mendekati Stok Minimum') statusColor = 'bg-amber-100 text-amber-700'; else if (a.status === 'Stok Minimum Tercapai') statusColor = 'bg-orange-100 text-orange-700'; else if (a.status === 'Di Bawah Stok Minimum') statusColor = 'bg-red-100 text-[#991B1B]';
                    return (
                      <tr key={a.id} className="hover:bg-[#F8FAFC]">
                        <td className="p-4">{a.sku} - {a.name}</td><td className="p-4 text-center">{a.totalUnitsSold}</td><td className="p-4 text-center">{a.dailyAverage.toFixed(2)}</td><td className="p-4 text-center text-blue-700">{a.minStock}</td><td className="p-4 text-center">{a.sellableStock}</td><td className="p-4 text-center text-slate-500">{a.stockInTransit}</td>
                        <td className="p-4 text-center"><span className={`px-2 py-1 rounded text-[10px] ${statusColor}`}>{a.status}</span></td>
                        <td className="p-4 text-center">{a.recommendedOrder > 0 ? ( <span className="text-[#DC2626] font-black">+{a.recommendedOrder} {a.unit}</span> ) : ( <span className="text-slate-400">-</span> )}</td>
                      </tr>
                    );
                  })}
                  {analyticsData.length === 0 && ( <tr><td colSpan={8} className="p-4 text-center text-[#64748B]">Memuat data analitik...</td></tr> )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      
      {role === 'Admin' && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Anggota" value={members.length} icon={Users} />
        <StatCard title="Piutang Beredar" value={formatRp(members.reduce((sum:number,m:any)=>sum+m.creditBalance,0))} icon={CreditCard} />
        <StatCard title="Omzet Hari Ini" value={formatRp(kasirTotalSales)} icon={Banknote} />
        <StatCard title="Review Kas Pending" value={pendingShiftsCount} icon={ShieldCheck} alertClass="border-red-400 bg-red-50/20" />
      </div>}
    </div>
  );
}

function MinStockSettingsView({ globalSetting, role }: any) {
  if (role !== 'Admin' && role !== 'Inventory') return null;
  const [formData, setFormData] = useState({ ...globalSetting });
  
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = { ...formData, periodDays: Number(formData.periodDays), percentage: Number(formData.percentage), leadTimeDays: Number(formData.leadTimeDays), safetyStock: Number(formData.safetyStock) };
      await db.min_stock_settings.put(p);
      await logAudit(role, 'Ubah Pengaturan Stok Minimum', `Metode: ${formData.calculationMethod}, Periode: ${formData.periodDays} hari`);
      alert("Pengaturan stok minimum berhasil disimpan!");
    } catch(err) { alert("Gagal menyimpan pengaturan."); }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
      <div className="p-5 bg-white border-b border-[#E2E8F0]"><h2 className="text-lg font-black text-[#1E293B] flex items-center gap-2"><Sliders size={20}/> Pengaturan Global Stok Minimum Otomatis</h2><p className="text-xs text-[#64748B] font-bold mt-1">Sistem akan menghitung rata-rata penjualan secara otomatis berdasarkan transaksi POS yang berhasil.</p></div>
      <form onSubmit={handleSave} className="p-6 space-y-6">
        <div><label className="block text-xs font-black text-[#1E293B] mb-2">Periode Analisis Penjualan (Hari)</label><select value={formData.periodDays} onChange={e=>setFormData({...formData, periodDays: e.target.value})} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm outline-none focus:border-[#DC2626]"><option value={7}>7 Hari Terakhir</option><option value={14}>14 Hari Terakhir</option><option value={30}>30 Hari Terakhir (1 Bulan)</option><option value={60}>60 Hari Terakhir (2 Bulan)</option><option value={90}>90 Hari Terakhir (3 Bulan)</option></select></div>
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><label className="block text-xs font-black text-[#1E293B] mb-4">Pilih Metode Perhitungan Utama</label>
          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer"><input type="radio" name="calcMethod" value="percentage" checked={formData.calculationMethod === 'percentage'} onChange={() => setFormData({...formData, calculationMethod: 'percentage'})} className="mt-1" /><div><span className="font-bold text-sm block">Metode Persentase (Agresif)</span><span className="text-[10px] text-slate-500 block">Stok Min = Rata-rata Harian × Hari Analisis × Persentase</span></div></label>
            <label className="flex items-start gap-3 cursor-pointer"><input type="radio" name="calcMethod" value="lead_time" checked={formData.calculationMethod === 'lead_time'} onChange={() => setFormData({...formData, calculationMethod: 'lead_time'})} className="mt-1" /><div><span className="font-bold text-sm block">Metode Lead Time & Safety Stock (Konservatif)</span><span className="text-[10px] text-slate-500 block">Stok Min = (Rata-rata Harian × Lead Time Supplier) + Safety Stock</span></div></label>
          </div>
        </div>
        {formData.calculationMethod === 'percentage' && (<div><label className="block text-xs font-black text-[#1E293B] mb-2">Persentase Minimum (%)</label><input type="number" min="1" max="200" value={formData.percentage} onChange={e=>setFormData({...formData, percentage: e.target.value})} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm outline-none focus:border-[#DC2626]" /></div>)}
        {formData.calculationMethod === 'lead_time' && (<div className="grid grid-cols-2 gap-4"><div><label className="block text-xs font-black text-[#1E293B] mb-2">Lead Time Supplier (Hari)</label><input type="number" min="1" value={formData.leadTimeDays} onChange={e=>setFormData({...formData, leadTimeDays: e.target.value})} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm outline-none focus:border-[#DC2626]" /></div><div><label className="block text-xs font-black text-[#1E293B] mb-2">Safety Stock (Buffer Unit)</label><input type="number" min="0" value={formData.safetyStock} onChange={e=>setFormData({...formData, safetyStock: e.target.value})} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm outline-none focus:border-[#DC2626]" /></div></div>)}
        <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black shadow-md transition">Simpan Pengaturan Global</button>
      </form>
    </div>
  )
}

function OpenShift({ role, loggedInUserId }: any) {
  const [opening, setOpening] = useState('');
  const openShift = async (e:any) => {
    e.preventDefault();
    const shift = { id: generateUUID(), shiftNumber: generateId('SHF'), cashier_id: loggedInUserId, cashierName: role, startTime: new Date().toISOString(), openingBalance: Number(opening), status: 'open', notes: '' };
    await db.shifts.add(shift);
    await enqueueSync('INSERT', 'shifts', shift);
    await logAudit(role, 'Buka Shift', `Shift ${shift.shiftNumber} modal awal: ${formatRp(shift.openingBalance)}`);
    window.location.reload();
  };
  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200 mt-10">
      <div className="text-center mb-6"><Wallet size={48} className="mx-auto text-red-600 mb-2"/><h2 className="text-xl font-black">Buka Shift Kasir</h2><p className="text-xs font-bold text-slate-500 mt-1">Anda wajib membuka shift sebelum mulai bertransaksi.</p></div>
      <form onSubmit={openShift} className="space-y-4">
        <div><label className="block text-xs font-black text-slate-600 mb-2">Modal Awal / Uang Kembalian (Rp)</label><input required type="number" min="0" value={opening} onChange={e=>setOpening(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold bg-slate-50 text-slate-800 outline-none focus:border-red-600" placeholder="0" /></div>
        <button type="submit" className="w-full py-3.5 bg-red-600 text-white rounded-xl font-black shadow-md">Mulai Shift Sekarang</button>
      </form>
    </div>
  );
}

function CloseShift({ role, sales, activeShift, expenses }: any) {
  if (role !== 'Kasir') return null;
  if (!activeShift) return <div className="p-6 bg-white rounded-2xl shadow-sm text-center font-bold text-slate-600">Tidak ada shift aktif.</div>;
  
  const [denoms, setDenoms] = useState({ d100k:0, d50k:0, d20k:0, d10k:0, d5k:0, d2k:0, d1k:0, coins:0 });
  const calcPhys = () => (denoms.d100k*100000) + (denoms.d50k*50000) + (denoms.d20k*20000) + (denoms.d10k*10000) + (denoms.d5k*5000) + (denoms.d2k*2000) + (denoms.d1k*1000) + (denoms.coins);
  
  const shiftSales = sales.filter((s:any) => s.shiftId === activeShift.id && s.status === 'completed');
  const cashSales = shiftSales.filter((s:any) => s.paymentMethod === 'Tunai').reduce((sum:number, s:any) => sum + s.paymentReceived - s.change, 0); 
  const qrisSales = shiftSales.filter((s:any) => s.paymentMethod === 'QRIS').reduce((sum:number, s:any) => sum + s.total, 0);
  const transferSales = shiftSales.filter((s:any) => s.paymentMethod === 'Transfer').reduce((sum:number, s:any) => sum + s.total, 0);
  const creditSales = shiftSales.filter((s:any) => s.paymentMethod === 'Kredit').reduce((sum:number, s:any) => sum + s.total, 0);
  
  const shiftExpenses = expenses.filter((e:any) => e.date >= activeShift.startTime).reduce((sum:number, e:any)=> sum+e.amount, 0);
  const expectedCash = activeShift.openingBalance + cashSales - shiftExpenses;
  const physCash = calcPhys();
  const variance = physCash - expectedCash;

  const submitClose = async () => {
    if(!window.confirm('Tutup shift sekarang? Laporan akan dikirim ke Admin dan Anda tidak bisa bertransaksi sebelum shift baru.')) return;
    const up = { endTime: new Date().toISOString(), expected_cash: expectedCash, physical_cash: physCash, variance, status: 'pending_verification', cash_details: denoms };
    await db.shifts.update(activeShift.id, up);
    await enqueueSync('UPDATE', 'shifts', { id: activeShift.id, ...up });
    await logAudit(role, 'Tutup Shift', `Menutup shift ${activeShift.shiftNumber}`);
    window.location.reload();
  };

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="font-black text-lg mb-4 text-slate-800">Ringkasan Penjualan Shift</h3>
        <ul className="space-y-3 text-sm font-bold text-slate-600">
          <li className="flex justify-between"><span>Nomor Shift</span><span className="text-slate-800">{activeShift.shiftNumber}</span></li>
          <li className="flex justify-between"><span>Modal Awal Laci</span><span className="text-slate-800">{formatRp(activeShift.openingBalance)}</span></li>
          <li className="flex justify-between"><span>Penjualan Tunai</span><span className="text-slate-800">+{formatRp(cashSales)}</span></li>
          <li className="flex justify-between"><span>Pengeluaran Kas Disetujui</span><span className="text-red-600">-{formatRp(shiftExpenses)}</span></li>
          <hr className="my-2 border-slate-200"/>
          <li className="flex justify-between text-base text-slate-800"><span>Seharusnya Uang Tunai:</span><span className="font-black text-blue-700">{formatRp(expectedCash)}</span></li>
          <hr className="my-2 border-slate-200"/>
          <li className="flex justify-between text-xs"><span>Penjualan Non-Tunai (QRIS/Trf)</span><span>{formatRp(qrisSales+transferSales)}</span></li>
          <li className="flex justify-between text-xs"><span>Penjualan Kredit (Potong Gaji)</span><span>{formatRp(creditSales)}</span></li>
        </ul>
      </div>
      
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <h3 className="font-black text-lg mb-4 text-slate-800">Hitung Uang Fisik</h3>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[100000,50000,20000,10000,5000,2000,1000].map(val => (
             <div key={val} className="flex items-center justify-between p-2 border rounded-lg bg-slate-50"><span className="text-[10px] font-black">{formatRp(val)}</span><input type="number" min="0" placeholder="Lbr" className="w-16 p-1 text-center font-bold border rounded outline-none" onChange={e=>setDenoms({...denoms, [`d${val/1000}k`]: Number(e.target.value)||0})} /></div>
          ))}
          <div className="flex items-center justify-between p-2 border rounded-lg bg-slate-50"><span className="text-[10px] font-black">Total Koin / Lainnya</span><input type="number" min="0" className="w-20 p-1 text-center font-bold border rounded outline-none" onChange={e=>setDenoms({...denoms, coins: Number(e.target.value)||0})} /></div>
        </div>
        <div className="p-4 rounded-xl bg-slate-100 flex justify-between font-black text-slate-800 mb-4"><span>Total Aktual:</span><span>{formatRp(physCash)}</span></div>
        <div className={`p-4 rounded-xl font-black flex justify-between mb-6 ${variance===0?'bg-green-100 text-green-700':variance>0?'bg-blue-100 text-blue-700':'bg-red-100 text-red-700'}`}><span>Selisih:</span><span>{variance>0?'+':''}{formatRp(variance)}</span></div>
        <button onClick={submitClose} className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-black shadow-md hover:bg-black transition">Serahkan Setoran ke Admin</button>
      </div>
    </div>
  )
}

function POS({ products, batches, role, members, activeShift, appLogoUrl, loggedInUserId }: any) {
  if (role !== 'Kasir') return null;
  const [cart, setCart] = useState<any[]>([]); const [searchTerm, setSearchTerm] = useState(''); 
  const [customerType, setCustomerType] = useState('Umum'); const [selectedMember, setSelectedMember] = useState('');
  const [payMethod, setPayMethod] = useState('Tunai'); const [payAmount, setPayAmount] = useState(''); 
  const [receiptData, setReceiptData] = useState<any>(null); const [isProcessing, setIsProcessing] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const filteredProds = products.filter((p:any) => !p.isArchived && p.stock>0 && (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase())));
  const activeMember = members.find((m:any) => m.id === selectedMember);
  
  const addToCart = (prod: any) => {
    const existing = cart.find(i => i.productId === prod.id);
    if (existing) { if(existing.qty < prod.stock) setCart(cart.map(i => i.productId === prod.id ? {...i, qty: i.qty+1} : i)); }
    else { setCart([...cart, { productId: prod.id, name: prod.name, price: prod.price, memberPrice: prod.memberPrice||prod.price, hpp: prod.hpp, qty: 1, unit: prod.unit, maxStock: prod.stock }]); }
  };
  const updateQty = (id:string, delta:number) => { setCart(cart.map(i => i.productId===id ? {...i, qty: Math.min(Math.max(1, i.qty+delta), i.maxStock)} : i)); };
  const totalAmount = cart.reduce((sum, item) => sum + (item.qty * (customerType==='Anggota' ? item.memberPrice : item.price)), 0);
  const change = (payMethod==='Tunai' && payAmount) ? Number(payAmount) - totalAmount : 0;

  const handleCheckout = async () => {
    if(cart.length===0 || isProcessing) return;
    if(payMethod==='Tunai' && change < 0) return alert('Pembayaran tunai kurang!');
    if(payMethod==='Kredit' && customerType!=='Anggota') return alert('Hanya anggota yang bisa menggunakan kredit potong gaji.');
    
    setIsProcessing(true);
    try {
      const receiptNo = generateReceiptNumber(); let totalHpp = 0; let totalProfit = 0;
      const todayStr = new Date().toISOString().split('T')[0];
      const batchUpdates:any[] = []; const prodUpdates:any[] = []; const allocItems:any[] = [];

      for (const item of cart) {
        let needed = item.qty;
        const prodBatches = batches.filter((b:any) => b.productId===item.productId && b.qty>0 && b.condition==='Baik' && b.expiryDate>=todayStr).sort((a:any, b:any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
        let itemHpp = 0;
        for (const b of prodBatches) {
          if (needed <= 0) break;
          const take = Math.min(b.qty, needed);
          itemHpp += take * b.hpp; needed -= take;
          const exUpdate = batchUpdates.find(bu=>bu.id===b.id);
          if (exUpdate) exUpdate.qty -= take; else batchUpdates.push({id:b.id, qty: b.qty-take});
        }
        if (needed > 0) throw new Error(`Stok batch aktif produk ${item.name} tidak cukup/expired!`);
        
        const finalPrice = customerType==='Anggota' ? item.memberPrice : item.price;
        const sub = finalPrice * item.qty;
        totalHpp += itemHpp; totalProfit += (sub - itemHpp);
        allocItems.push({ ...item, product_id: item.productId, price: finalPrice, subtotal: sub });
        prodUpdates.push({ id: item.productId, reduce: item.qty });
      }

      const saleId = generateUUID();
      const saleData = {
        id: saleId, receipt_number: receiptNo, date: new Date().toISOString(), shift_id: activeShift.id,
        items: allocItems, total: totalAmount, hpp_total: totalHpp, profit: totalProfit,
        payment_method: payMethod, payment_received: payMethod==='Tunai'?Number(payAmount):totalAmount, change: change>0?change:0,
        status: 'completed', cashier_id: loggedInUserId, member_id: customerType==='Anggota'?selectedMember:null
      };

      await db.transaction('rw', db.sales, db.products, db.product_batches, db.members, db.audit_logs, db.sync_queue, async () => {
        const dexieSaleData = { ...saleData, receiptNumber: saleData.receipt_number, shiftId: saleData.shift_id, cashierRole: role };
        await db.sales.add(dexieSaleData);
        await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'sales', payload: saleData, created_at: new Date().toISOString() });
        
        for(const bu of batchUpdates) await db.product_batches.update(bu.id, {qty:bu.qty});
        for(const pu of prodUpdates) { const p = await db.products.get(pu.id); if(p) await db.products.update(p.id, {stock:p.stock-pu.reduce}); }
        
        if (customerType==='Anggota' && activeMember) {
          const up = payMethod==='Kredit' ? { creditBalance: activeMember.creditBalance + totalAmount } : { points: activeMember.points + Math.floor(totalAmount/10000) };
          await db.members.update(activeMember.id, up);
          await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'members', payload: { id: activeMember.id, ...up }, created_at: new Date().toISOString() });
        }
        
        const logId = generateUUID();
        const auditPayload = { id: logId, timestamp: new Date().toISOString(), role: 'Kasir', action: 'Transaksi Penjualan (FIFO)', details: `Transaksi ${receiptNo}` };
        await db.audit_logs.add(auditPayload);
        await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'audit_logs', payload: auditPayload, created_at: new Date().toISOString() });
      });
      triggerPushSync();
      setReceiptData(saleData); setCart([]); setPayAmount(''); setIsCartOpen(false);
    } catch(err:any) { alert(err.message || 'Gagal checkout.'); }
    setIsProcessing(false);
  };

  if (receiptData) return (
    <div className="flex justify-center items-center h-full"><div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm border border-[#E2E8F0]" id="receipt-print">
      <div className="text-center mb-4">
        {appLogoUrl ? <img src={appLogoUrl} alt="Logo" className="w-12 h-12 mx-auto mb-2 print:hidden object-cover rounded-full" /> : <Check size={40} className="mx-auto text-[#DC2626] mb-2 print:hidden" />}
        <h2 className="text-xl font-black">GERAI KMP PKT</h2>
        <p className="text-[#64748B] font-mono text-xs mt-1">{receiptData.receipt_number}</p>
        <p className="text-[10px] text-slate-500">{new Date(receiptData.date).toLocaleString('id-ID')}</p>
      </div>
      <div className="border-y border-dashed border-[#E2E8F0] py-4 mb-4 space-y-2 text-sm">{receiptData.items.map((item: any, idx: number) => ( <div key={idx} className="flex justify-between font-bold text-[#1E293B] text-xs"><div><p>{item.name}</p><p className="text-[#64748B]">{item.qty} x {formatRp(item.price)}</p></div><p>{formatRp(item.subtotal)}</p></div> ))}</div>
      
      <div className="text-sm font-black space-y-1 mb-4">
           <div className="flex justify-between"><span>TOTAL</span><span>{formatRp(receiptData.total)}</span></div>
           <div className="flex justify-between text-slate-500 text-xs"><span>Metode: {receiptData.payment_method}</span><span>Diterima: {formatRp(receiptData.payment_received)}</span></div>
           {receiptData.change > 0 && <div className="flex justify-between text-slate-500 text-xs"><span>Kembalian</span><span>{formatRp(receiptData.change)}</span></div>}
           {receiptData.member_id && <div className="mt-2 text-center text-[10px] bg-slate-100 p-1 rounded">Transaksi Member / Tambahan Poin Tersimpan</div>}
      </div>

      <div className="mt-6 flex gap-3 print:hidden"><button onClick={() => window.print()} className="flex-1 bg-[#F8FAFC] border-2 border-[#E2E8F0] text-[#1E293B] py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Printer size={16} /> Cetak</button><button onClick={() => setReceiptData(null)} className="flex-1 bg-[#DC2626] text-white py-3 rounded-xl font-bold shadow-md text-sm">Selesai</button></div>
      <style>{`@media print { body * { visibility: hidden; } #receipt-print, #receipt-print * { visibility: visible; } #receipt-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; border: none; } }`}</style>
    </div></div>
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-10rem)] gap-0 lg:gap-6 relative">
      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        <div className="p-4 bg-white border-b border-[#E2E8F0]"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#64748B]" size={18} /><input type="text" placeholder="Cari barang atau SKU..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-[#E2E8F0] focus:outline-none focus:border-[#DC2626] font-bold text-sm bg-[#F8FAFC]" /></div></div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProds.map((p: any) => (
              <div key={p.id} onClick={() => addToCart(p)} className="bg-white border-2 border-[#E2E8F0] rounded-xl p-3 cursor-pointer hover:border-[#DC2626] transition flex flex-col shadow-sm">
                <span className="text-[9px] font-black text-white bg-[#64748B] px-1.5 py-0.5 rounded w-fit mb-2">Stok: {p.stock}</span>
                <h4 className="font-bold text-[#1E293B] text-xs leading-tight mb-1 flex-1">{p.name}</h4>
                {customerType==='Anggota' && p.memberPrice < p.price ? 
                 <div className="text-right mt-2"><span className="line-through text-[10px] text-slate-400 block">{formatRp(p.price)}</span><span className="font-black text-[#DC2626] text-sm">{formatRp(p.memberPrice)}</span></div> : 
                 <div className="text-right mt-2"><span className="font-black text-[#DC2626] text-sm">{formatRp(p.price)}</span></div>
                }
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className="lg:hidden fixed bottom-6 right-6 bg-[#DC2626] text-white p-4 rounded-full shadow-2xl z-40" onClick={() => setIsCartOpen(true)}><ShoppingCart size={24} /><span className="absolute -top-2 -right-2 bg-white text-[#DC2626] font-black border-2 border-[#DC2626] rounded-full w-7 h-7 flex items-center justify-center text-xs">{cart.length}</span></button>

      <div className={`fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl z-50 transform ${isCartOpen ? 'translate-x-0' : 'translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300 flex flex-col shrink-0 border-l lg:border-none lg:rounded-2xl border-[#E2E8F0]`}>
        <div className="p-4 bg-white border-b border-[#E2E8F0] flex justify-between items-center lg:rounded-t-2xl"><h3 className="font-black text-[#1E293B] flex items-center gap-2"><ShoppingCart size={18}/> Keranjang</h3><div className="flex items-center gap-3"><span className="bg-[#FEE2E2] text-[#991B1B] text-xs font-black px-2 py-1 rounded-md">{cart.length} Item</span><button className="lg:hidden text-[#64748B]" onClick={() => setIsCartOpen(false)}><X size={20}/></button></div></div>
        
        <div className="p-4 border-b space-y-3">
             <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
                {['Umum','Anggota'].map(t => <button key={t} onClick={()=>setCustomerType(t)} className={`flex-1 py-1.5 text-xs font-black rounded-md ${customerType===t?'bg-white text-[#DC2626] shadow-sm':'text-slate-500'}`}>{t}</button>)}
             </div>
             {customerType==='Anggota' && (
                <select value={selectedMember} onChange={e=>setSelectedMember(e.target.value)} className="w-full p-2 border-2 border-[#E2E8F0] rounded-lg font-bold text-xs outline-none">
                  <option value="">Pilih Anggota...</option>
                  {members.filter((m:any)=>m.status==='Aktif').map((m:any) => <option key={m.id} value={m.id}>{m.noInduk} - {m.name}</option>)}
                </select>
             )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-2 bg-[#F8FAFC]">
          {cart.map(item => (
            <div key={item.productId} className="bg-white border border-[#E2E8F0] p-3 rounded-xl shadow-sm">
              <div className="flex justify-between mb-2"><span className="font-bold text-xs text-[#1E293B]">{item.name}</span><button onClick={() => setCart(cart.filter(i => i.productId !== item.productId))} className="text-[#64748B] hover:text-[#DC2626]"><Trash2 size={14}/></button></div>
              <div className="flex justify-between items-center"><span className="text-xs font-black text-[#DC2626]">{formatRp(customerType==='Anggota'?item.memberPrice:item.price)}</span><div className="flex items-center gap-2 bg-[#F8FAFC] rounded-lg p-1 border border-[#E2E8F0]"><button onClick={() => updateQty(item.productId, -1)} className="p-1 bg-white rounded shadow-sm text-[#1E293B]"><Minus size={12}/></button><span className="text-xs font-black w-4 text-center">{item.qty}</span><button onClick={() => updateQty(item.productId, 1)} className="p-1 bg-white rounded shadow-sm text-[#1E293B]"><Plus size={12}/></button></div></div>
            </div>
          ))}
        </div>
        <div className="p-4 bg-white border-t border-[#E2E8F0] lg:rounded-b-2xl space-y-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="flex justify-between font-black text-base text-[#1E293B]"><span>Total</span><span className="text-[#DC2626]">{formatRp(totalAmount)}</span></div>
          <div>
             <div className="grid grid-cols-2 gap-2 mb-2">{['Tunai', 'QRIS', 'Transfer', 'Kredit'].map(m => (<button key={m} onClick={() => setPayMethod(m)} className={`py-2 rounded-xl text-xs font-black border-2 transition ${payMethod === m ? 'bg-[#DC2626] text-white border-[#DC2626]' : 'bg-white text-[#64748B] border-[#E2E8F0]'}`}>{m}</button>))}</div>
             {payMethod === 'Tunai' && (<input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="Nominal Uang" className="w-full p-3 rounded-xl border-2 border-[#E2E8F0] font-black text-sm focus:border-[#DC2626] outline-none bg-[#F8FAFC]"/>)}
          </div>
          <button onClick={handleCheckout} disabled={cart.length === 0 || isProcessing || (payMethod==='Tunai' && change < 0 && payAmount !== '') || (payMethod==='Kredit' && !selectedMember)} className="w-full bg-[#DC2626] hover:bg-[#991B1B] disabled:bg-[#cbd5e1] disabled:text-[#f1f5f9] text-white py-3.5 rounded-xl font-black text-sm shadow-md transition">Selesai Pembayaran</button>
        </div>
      </div>
    </div>
  );
}

function Products({ products, batches, role }: any) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modalType, setModalType] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [showArchived, setShowArchived] = useState(false);
  
  const filtered = products.filter((p: any) => { if (!showArchived && p.isArchived) return false; return p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase()); });
  const totalInventoryValue = products.filter((p:any) => !p.isArchived).reduce((acc: number, p: any) => { const pBatches = batches.filter((b:any) => b.productId === p.id && b.condition === 'Baik' && b.qty > 0); return acc + pBatches.reduce((sum:number, b:any) => sum + (b.qty * b.hpp), 0); }, 0);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { 
        sku: formData.sku, name: formData.name, category: formData.category, unit: formData.unit, hpp: Number(formData.hpp), 
        price: Number(formData.price), member_price: Number(formData.memberPrice || formData.price), min_stock: Number(formData.minStock || 10),
        is_archived: formData.isArchived || false
      };
      if (formData.id) {
        await db.products.update(formData.id, { ...payload, memberPrice: payload.member_price, minStock: payload.min_stock, isArchived: payload.is_archived });
        await enqueueSync('UPDATE', 'products', { id: formData.id, ...payload });
        await logAudit(role, 'Ubah Master Barang', `Ubah ${formData.name}`);
      } else {
        const id = generateUUID();
        await db.products.add({ id, ...payload, memberPrice: payload.member_price, minStock: payload.min_stock, isArchived: payload.is_archived, stock: 0 });
        await enqueueSync('INSERT', 'products', { id, ...payload, stock: 0 });
        await logAudit(role, 'Tambah Master Barang', `Tambah ${formData.name}`);
      }
      setModalType(null);
    } catch (err) { alert("Error menyimpan lokal"); }
  };

  const toggleArchive = async (p: any) => {
    if (!p.isArchived && p.stock > 0) { if (!window.confirm(`Barang "${p.name}" masih ada stok. Yakin arsipkan?`)) return; }
    try {
      await db.products.update(p.id, { isArchived: !p.isArchived });
      await enqueueSync('UPDATE', 'products', { id: p.id, is_archived: !p.isArchived });
      await logAudit(role, p.isArchived ? 'Aktifkan Barang' : 'Arsipkan Barang', p.name);
    } catch(err) { alert("Gagal memperbarui status arsip."); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col h-full overflow-hidden">
      <div className="p-4 md:p-6 border-b border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white">
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" size={16} /><input type="text" placeholder="Cari barang atau SKU..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-xl border-2 border-[#E2E8F0] focus:outline-none focus:border-[#DC2626] font-bold text-sm bg-[#F8FAFC]" /></div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded" /> Tampilkan Arsip</label>
        </div>
        <div className="flex gap-3 w-full sm:w-auto items-center">
          {role === 'Admin' || role === 'Inventory' ? ( <div className="bg-green-50 text-green-700 px-4 py-2 rounded-xl border border-green-200 text-xs font-black shadow-sm whitespace-nowrap">Nilai Persediaan: {formatRp(totalInventoryValue)}</div> ) : null}
          {role === 'Admin' && ( <button onClick={() => { setFormData({ id: null, sku: '', name: '', category: '', unit: 'Pcs', hpp: 0, price: 0, memberPrice: 0, minStock: 10 }); setModalType('edit'); }} className="w-full sm:w-auto bg-[#DC2626] hover:bg-[#991B1B] text-white px-5 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md text-sm"><Plus size={16}/> Tambah</button> )}
        </div>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead className="bg-[#F8FAFC] text-[#64748B] text-[10px] font-black uppercase tracking-wider sticky top-0 border-b border-[#E2E8F0]"><tr><th className="p-4">SKU & Nama Barang</th>{role === 'Admin' && <th className="p-4 text-right">HPP</th>}<th className="p-4 text-right">Harga Umum</th><th className="p-4 text-right">Harga Anggota</th><th className="p-4 text-center">Stok</th>{(role === 'Inventory' || role === 'Admin') && <th className="p-4 text-right">Nilai Persediaan</th>}<th className="p-4 text-center">Aksi</th></tr></thead>
          <tbody className="text-xs font-bold text-[#1E293B] divide-y divide-[#E2E8F0]">
            {filtered.map((p: any) => {
              const pBatches = batches.filter((b:any) => b.productId === p.id && b.condition === 'Baik' && b.qty > 0); const pValue = pBatches.reduce((sum:number, b:any) => sum + (b.qty * b.hpp), 0);
              return (
              <tr key={p.id} className={`hover:bg-[#F8FAFC] ${p.isArchived ? 'opacity-60 bg-slate-50' : ''}`}>
                <td className="p-4">{p.sku} - {p.name} {p.isArchived && <span className="ml-2 bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-[9px] font-black uppercase">Diarsipkan</span>}<span className="text-[10px] text-[#64748B] block mt-0.5">{p.category}</span></td>
                {role === 'Admin' && <td className="p-4 text-right text-[#64748B]">{formatRp(p.hpp)}</td>}
                <td className="p-4 text-right text-[#DC2626]">{formatRp(p.price)}</td><td className="p-4 text-right text-blue-600">{formatRp(p.memberPrice || p.member_price)}</td><td className="p-4 text-center"><span className={`px-2 py-1 rounded text-[10px] ${p.stock <= (p.minStock ?? 10) ? 'bg-[#991B1B] text-white' : 'bg-[#E2E8F0] text-[#1E293B]'}`}>{p.stock} {p.unit}</span></td>
                {(role === 'Inventory' || role === 'Admin') && ( <td className="p-4 text-right text-green-700">{formatRp(pValue)}</td> )}
                <td className="p-4 text-center flex justify-center gap-3">{role === 'Admin' && <button onClick={() => { setFormData({...p, memberPrice: p.memberPrice||p.member_price, minStock: p.minStock||p.min_stock}); setModalType('edit'); }} className="text-[#DC2626] hover:underline">Edit</button>}{(role === 'Admin' || role === 'Inventory') && ( <button onClick={() => toggleArchive(p)} className="text-slate-500 hover:text-[#DC2626]" title={p.isArchived ? 'Aktifkan' : 'Arsipkan'}>{p.isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button> )}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      
      {modalType === 'edit' && role === 'Admin' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"><div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[#E2E8F0] overflow-hidden"><div className="p-5 border-b border-[#E2E8F0] bg-white flex justify-between items-center"><h3 className="font-black text-[#1E293B]">{formData.id ? 'Edit Master Barang' : 'Tambah Master Barang'}</h3><button onClick={() => setModalType(null)}><X size={20}/></button></div>
            <form onSubmit={handleSaveEdit} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4"><div><label className="block text-[10px] font-black text-[#64748B] mb-1">SKU</label><input required type="text" value={formData.sku} onChange={e=>setFormData({...formData, sku: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none focus:border-[#DC2626] text-sm font-bold bg-[#F8FAFC]" /></div><div><label className="block text-[10px] font-black text-[#64748B] mb-1">Kategori</label><input required type="text" value={formData.category} onChange={e=>setFormData({...formData, category: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none focus:border-[#DC2626] text-sm font-bold bg-[#F8FAFC]" /></div></div>
              <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Nama Barang</label><input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none focus:border-[#DC2626] text-sm font-bold bg-[#F8FAFC]" /></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="block text-[10px] font-black text-[#64748B] mb-1">HPP (Rp)</label><input required type="number" value={formData.hpp} onChange={e=>setFormData({...formData, hpp: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none text-sm font-bold bg-[#F8FAFC]" /></div><div><label className="block text-[10px] font-black text-[#64748B] mb-1">Batas Min Stok</label><input required type="number" value={formData.minStock} onChange={e=>setFormData({...formData, minStock: e.target.value})} className="w-full border-2 border-[#E2E8F0] rounded-xl p-2.5 outline-none text-sm font-bold bg-[#F8FAFC]" /></div></div>
              <div className="grid grid-cols-2 gap-3"><div><label className="block text-[10px] font-black text-[#64748B] mb-1">Harga UMUM</label><input required type="number" value={formData.price} onChange={e=>setFormData({...formData, price: e.target.value})} className="w-full border-2 border-[#DC2626] rounded-xl p-2.5 outline-none text-sm font-bold text-[#DC2626] bg-[#FEE2E2]/30" /></div><div><label className="block text-[10px] font-black text-[#64748B] mb-1">Harga ANGGOTA</label><input required type="number" value={formData.memberPrice} onChange={e=>setFormData({...formData, memberPrice: e.target.value})} className="w-full border-2 border-blue-600 rounded-xl p-2.5 outline-none text-sm font-bold text-blue-700 bg-blue-50" /></div></div>
              <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black mt-2 shadow-md">Simpan ke Lokal</button>
            </form>
        </div></div>
      )}
    </div>
  );
}

function Members({ members, role }: any) {
  if (role !== 'Admin') return <div className="flex h-full items-center justify-center font-bold text-red-600">Akses Ditolak. Khusus Admin.</div>;
  const [modal, setModal] = useState<any>(null);
  
  const save = async (e:any) => {
    e.preventDefault();
    if (modal.id) {
      await db.members.update(modal.id, modal);
      await enqueueSync('UPDATE', 'members', modal);
    } else {
      const newM = { id: generateUUID(), ...modal, join_date: new Date().toISOString().split('T')[0], status: 'Aktif', points: 0, credit_balance: 0 };
      await db.members.add({...newM, noInduk: newM.no_induk, joinDate: newM.join_date, creditBalance: 0});
      await enqueueSync('INSERT', 'members', newM);
    }
    setModal(null); await logAudit('Admin', 'Update Data Anggota', modal.name);
  };
  
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col h-full overflow-hidden">
       <div className="p-4 border-b border-[#E2E8F0] flex justify-between items-center"><div className="font-black text-lg">Manajemen Anggota</div><button onClick={()=>setModal({})} className="bg-slate-800 text-white px-4 py-2 rounded-xl font-bold text-sm">+ Anggota Baru</button></div>
       <div className="flex-1 overflow-auto custom-scrollbar">
         <table className="w-full text-left text-xs whitespace-nowrap"><thead className="bg-[#F8FAFC] text-[#64748B] text-[10px] uppercase font-black sticky top-0 border-b border-[#E2E8F0]"><tr><th className="p-4">Identitas</th><th className="p-4">Kontak</th><th className="p-4 text-center">Poin Tersedia</th><th className="p-4 text-right">Saldo Piutang</th><th className="p-4 text-center">Status</th><th className="p-4 text-center">Aksi</th></tr></thead>
         <tbody className="font-bold text-[#1E293B] divide-y divide-[#E2E8F0]">{members.map((m:any) => (
            <tr key={m.id} className="hover:bg-[#F8FAFC]">
               <td className="p-4">{m.noInduk || m.no_induk}<br/><span className="text-sm font-black text-slate-800">{m.name}</span></td>
               <td className="p-4">{m.phone}<br/><span className="text-[10px] text-slate-500">{m.address}</span></td>
               <td className="p-4 text-center text-orange-500 text-sm font-black">{m.points}</td>
               <td className="p-4 text-right text-red-600">{formatRp(m.creditBalance || m.credit_balance)}</td>
               <td className="p-4 text-center"><span className={`px-2 py-1 rounded text-white text-[10px] ${m.status==='Aktif'?'bg-green-600':'bg-red-600'}`}>{m.status}</span></td>
               <td className="p-4 text-center"><button onClick={()=>setModal({...m, no_induk: m.noInduk || m.no_induk})} className="text-[#DC2626] hover:underline">Edit</button></td>
            </tr>
         ))}</tbody></table>
       </div>
       {modal && (
         <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[60]"><div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden border border-[#E2E8F0]">
           <div className="p-4 border-b flex justify-between font-black text-[#1E293B]">Data Anggota <button onClick={()=>setModal(null)}><X/></button></div>
           <form onSubmit={save} className="p-4 space-y-3 text-xs font-bold">
             <input required placeholder="No Induk Koperasi" value={modal.no_induk||''} onChange={e=>setModal({...modal,no_induk:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"/>
             <input required placeholder="Nama Lengkap" value={modal.name||''} onChange={e=>setModal({...modal,name:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"/>
             <input required placeholder="No HP / WhatsApp" value={modal.phone||''} onChange={e=>setModal({...modal,phone:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"/>
             <textarea placeholder="Alamat Lengkap" value={modal.address||''} onChange={e=>setModal({...modal,address:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none" rows={2}/>
             {modal.id && <select value={modal.status} onChange={e=>setModal({...modal,status:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"><option value="Aktif">Aktif</option><option value="Nonaktif">Nonaktif</option></select>}
             <button className="w-full bg-slate-800 text-white py-3.5 rounded-xl font-black mt-2 shadow-md">Simpan Anggota</button>
           </form>
         </div></div>
       )}
    </div>
  )
}

function PurchaseOrders({ products, purchases, role, loggedInUserId }: any) {
  const [selectedProduct, setSelectedProduct] = useState(''); const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState(''); const [price, setPrice] = useState(''); const [notes, setNotes] = useState('');
  const activeProducts = products.filter((p:any) => !p.isArchived);

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = activeProducts.find((prod: any) => prod.id === selectedProduct);
    if (!p) return;
    try {
      const poData = {
        id: generateUUID(), po_number: generatePONumber(), date: new Date().toISOString(), supplier: supplier || 'Umum',
        items: [{ productId: p.id, name: p.name, qty: Number(qty), price: Number(price), total: Number(qty) * Number(price) }],
        total: Number(qty) * Number(price), status: 'pending', requested_by: loggedInUserId, notes
      };
      await db.purchases.add({...poData, poNumber: poData.po_number});
      await enqueueSync('INSERT', 'purchases', poData);
      await logAudit(role, 'Buat Purchase Order', `PO ${poData.po_number} untuk ${p.name}`);
      alert("Purchase Order berhasil diajukan ke Admin.");
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
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Pilih Produk</label><select required value={selectedProduct} onChange={e=>setSelectedProduct(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]"><option value="">-- Pilih Barang --</option>{activeProducts.map((p:any)=><option key={p.id} value={p.id}>{p.sku} - {p.name} (Stok: {p.stock})</option>)}</select></div>
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Nama Supplier</label><input required type="text" placeholder="PT Supplier Sejahtera" value={supplier} onChange={e=>setSupplier(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Jumlah Pesan (Qty)</label><input required type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-sm bg-[#F8FAFC]" /></div>
              <div><label className="block text-xs font-black text-[#64748B] mb-1">Estimasi Harga Beli / Unit (Rp)</label><input required type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} className="w-full p-3 border-2 border-[#DC2626] rounded-xl font-bold text-sm text-[#DC2626] bg-[#FEE2E2]/20" /></div>
            </div>
            <div><label className="block text-xs font-black text-[#64748B] mb-1">Catatan Pengajuan</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold text-xs bg-[#F8FAFC]"></textarea></div>
            <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black shadow-md">Kirim PO ke Admin</button>
          </form>
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0] font-black text-sm">Daftar Purchase Order (PO)</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[#64748B] uppercase font-black"><tr><th className="p-4">No. PO</th><th className="p-4">Supplier</th><th className="p-4">Item & Qty</th><th className="p-4">Total (Rp)</th><th className="p-4 text-center">Status</th></tr></thead>
          <tbody className="divide-y divide-[#E2E8F0] font-bold">
            {purchases.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-[#64748B]">Belum ada data PO.</td></tr> : purchases.map((p:any)=>(
              <tr key={p.id} className="hover:bg-[#F8FAFC]">
                <td className="p-4 text-[#DC2626] font-mono">{p.poNumber || p.po_number}</td><td className="p-4">{p.supplier}</td><td className="p-4">{p.items?.[0]?.name} (x{p.items?.[0]?.qty})</td><td className="p-4">{formatRp(p.total)}</td>
                <td className="p-4 text-center"><span className={`px-2.5 py-1 rounded-md text-[10px] ${p.status==='approved'?'bg-green-100 text-green-700':p.status==='rejected'?'bg-red-100 text-[#991B1B]':'bg-amber-100 text-amber-700'}`}>{p.status.toUpperCase()}</span></td>
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
  const [selectedPO, setSelectedPO] = useState(''); const [goodQty, setGoodQty] = useState(''); const [damagedQty, setDamagedQty] = useState(''); 
  const [batchNumber, setBatchNumber] = useState(''); const [expiryDate, setExpiryDate] = useState(''); const [notes, setNotes] = useState('');

  const approvedPOs = purchases.filter((p: any) => p.status === 'approved');
  const currentPO = approvedPOs.find((p: any) => p.id === selectedPO);

  const handleInboundReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPO) return;
    try {
      const gQty = Number(goodQty || 0); const dQty = Number(damagedQty || 0);
      const item = currentPO.items[0]; const prod = products.find((p: any) => p.id === item.productId);
      if (!prod) return;

      const batchNum = batchNumber || `BATCH-${Date.now().toString().slice(-6)}`;
      const expDate = expiryDate || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0];

      await db.transaction('rw', db.purchases, db.products, db.product_batches, db.audit_logs, db.sync_queue, async () => {
        await db.purchases.update(currentPO.id, { status: 'received' });
        await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'purchases', payload: { id: currentPO.id, status: 'received' }, created_at: new Date().toISOString() });
        
        if (gQty > 0) {
          const batchId = generateUUID();
          const batch = { id: batchId, product_id: prod.id, batch_number: batchNum, qty: gQty, initial_qty: gQty, hpp: item.price, received_date: new Date().toISOString().split('T')[0], expiry_date: expDate, condition: 'Baik' };
          await db.product_batches.add({ ...batch, productId: batch.product_id, batchNumber: batch.batch_number, initialQty: batch.initial_qty, receivedDate: batch.received_date, expiryDate: batch.expiry_date, createdAt: new Date().toISOString() });
          await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'product_batches', payload: batch, created_at: new Date().toISOString() });
          
          const currentBatches = await db.product_batches.where('productId').equals(prod.id).toArray();
          const totalStock = currentBatches.reduce((sum, b) => sum + b.qty, 0);
          const totalValuation = currentBatches.reduce((sum, b) => sum + (b.qty * b.hpp), 0);
          const newHPP = totalStock > 0 ? Math.round(totalValuation / totalStock) : prod.hpp;
          await db.products.update(prod.id, { stock: totalStock, hpp: newHPP });
          await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'products', payload: { id: prod.id, stock: totalStock, hpp: newHPP }, created_at: new Date().toISOString() });
        }
        if (dQty > 0) {
          const dbatchId = generateUUID();
          const dbatch = { id: dbatchId, product_id: prod.id, batch_number: `${batchNum}-DMG`, qty: dQty, initial_qty: dQty, hpp: item.price, received_date: new Date().toISOString().split('T')[0], expiry_date: expDate, condition: 'Rusak' };
          await db.product_batches.add({ ...dbatch, productId: dbatch.product_id, batchNumber: dbatch.batch_number, initialQty: dbatch.initial_qty, receivedDate: dbatch.received_date, expiryDate: dbatch.expiry_date, createdAt: new Date().toISOString() });
          await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'product_batches', payload: dbatch, created_at: new Date().toISOString() });
        }
        const auditPayload = { id: generateUUID(), timestamp: new Date().toISOString(), role: 'Inventory', action: 'Penerimaan Inbound & Batch', details: `Menerima PO ${currentPO.poNumber}: Baik (${gQty}), Rusak (${dQty})` };
        await db.audit_logs.add(auditPayload);
        await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'audit_logs', payload: auditPayload, created_at: new Date().toISOString() });
      });
      triggerPushSync();
      alert("Penerimaan barang berhasil diproses!"); setSelectedPO(''); setGoodQty(''); setDamagedQty(''); setBatchNumber(''); setExpiryDate(''); setNotes('');
    } catch (err) { alert("Error saat memproses inbound."); }
  };

  return (
    <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
      <div className="p-5 bg-white border-b border-[#E2E8F0]"><h2 className="text-lg font-black text-[#1E293B]">Penerimaan Barang (Inbound & Batch)</h2></div>
      <form onSubmit={handleInboundReceive} className="p-5 space-y-4">
        <div>
          <label className="block text-[10px] font-black text-[#64748B] mb-1">Pilih PO yang Disetujui</label>
          <select required value={selectedPO} onChange={e=>setSelectedPO(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50"><option value="">-- Pilih PO Approved --</option>{approvedPOs.map((po:any)=><option key={po.id} value={po.id}>{po.poNumber || po.po_number} - {po.supplier} ({po.items?.[0]?.name}, Qty: {po.items?.[0]?.qty})</option>)}</select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Jumlah Barang Baik</label><input required type="number" min="0" value={goodQty} onChange={e=>setGoodQty(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" /></div>
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Jumlah Barang Rusak</label><input type="number" min="0" value={damagedQty} onChange={e=>setDamagedQty(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Nomor Batch</label><input required type="text" placeholder="BATCH-00X" value={batchNumber} onChange={e=>setBatchNumber(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" /></div>
          <div><label className="block text-[10px] font-black text-[#64748B] mb-1">Tanggal Kedaluwarsa</label><input required type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" /></div>
        </div>
        <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black shadow-md mt-2">Simpan Inbound & Buat Batch</button>
      </form>
    </div>
  );
}

function StockOpnameView({ products, stockOpnames, role, loggedInUserId }: any) {
  const [opnameItems, setOpnameItems] = useState<any[]>([]); const [notes, setNotes] = useState('');
  const activeProducts = products.filter((p:any) => !p.isArchived);

  const startOpname = () => { setOpnameItems(activeProducts.map((p: any) => ({ productId: p.id, productName: p.name, systemStock: p.stock, physicalStock: p.stock, variance: 0, reason: '' }))); };
  const handlePhysicalChange = (productId: string, val: string) => { const pStock = Number(val); setOpnameItems(opnameItems.map(item => item.productId === productId ? { ...item, physicalStock: pStock, variance: pStock - item.systemStock } : item)); };

  const submitOpname = async () => {
    try {
      const soData: any = { id: generateUUID(), date: new Date().toISOString(), status: 'pending', items: opnameItems, requested_by: loggedInUserId, notes };
      await db.stock_opnames.add(soData);
      await enqueueSync('INSERT', 'stock_opnames', soData);
      await logAudit(role, 'Pengajuan Stock Opname', 'Mengirim laporan opname ke Admin');
      alert("Laporan diajukan ke Admin."); setOpnameItems([]); setNotes('');
    } catch (err) { alert("Gagal mengajukan stock opname"); }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {role === 'Inventory' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
          <div className="flex justify-between items-center mb-4"><h3 className="font-black text-base text-[#1E293B]">Formulir Stock Opname Bulanan</h3>{opnameItems.length === 0 && <button onClick={startOpname} className="bg-[#DC2626] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md">Mulai Opname Baru</button>}</div>
          {opnameItems.length > 0 && (
            <div className="space-y-4">
              <div className="overflow-x-auto max-h-96"><table className="w-full text-left text-xs"><thead className="bg-slate-50 font-black sticky top-0"><tr><th className="p-3">Nama Produk</th><th className="p-3">Stok Sistem</th><th className="p-3">Stok Fisik Aktual</th><th className="p-3">Selisih</th><th className="p-3">Alasan Selisih</th></tr></thead>
              <tbody className="divide-y font-bold">{opnameItems.map((item) => (
                <tr key={item.productId} className="hover:bg-slate-50"><td className="p-3">{item.productName}</td><td className="p-3">{item.systemStock}</td><td className="p-3"><input type="number" value={item.physicalStock} onChange={e=>handlePhysicalChange(item.productId, e.target.value)} className="w-20 p-1.5 border rounded font-bold text-center" /></td><td className="p-3"><span className={`px-2 py-0.5 rounded ${item.variance===0?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{item.variance}</span></td><td className="p-3"><input type="text" placeholder="Keterangan..." value={item.reason} onChange={e=>setOpnameItems(opnameItems.map(i=>i.productId===item.productId?{...i,reason:e.target.value}:i))} className="w-full p-1.5 border rounded" /></td></tr>
              ))}</tbody></table></div>
              <div><label className="block text-xs font-black mb-1">Catatan Kesimpulan</label><input type="text" value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 rounded-xl" /></div>
              <button onClick={submitOpname} className="w-full bg-[#1E293B] text-white py-3 rounded-xl font-black shadow-md">Ajukan Berita Acara ke Admin</button>
            </div>
          )}
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden"><div className="p-4 bg-slate-50 border-b font-black text-sm">Riwayat Stock Opname</div>
        <table className="w-full text-left text-xs"><thead className="bg-slate-50 uppercase font-black"><tr><th className="p-4">Tanggal</th><th className="p-4">Catatan</th><th className="p-4 text-center">Status Berita Acara</th></tr></thead>
        <tbody className="divide-y font-bold">{stockOpnames.map((so:any)=>(<tr key={so.id} className="hover:bg-slate-50"><td className="p-4">{formatDate(so.date, true)}</td><td className="p-4">{so.notes || '-'}</td><td className="p-4 text-center"><span className={`px-2.5 py-1 rounded-md text-[10px] ${so.status==='approved'?'bg-green-100 text-green-700':so.status==='rejected'?'bg-red-100 text-[#991B1B]':'bg-amber-100 text-amber-700'}`}>{so.status.toUpperCase()}</span></td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

function HistoryView({ sales, purchases, role }: any) {
  const [filter, setFilter] = useState('sales');
  const requestCancel = async (id: string, receiptNo: string) => {
    if(window.confirm(`Ajukan pembatalan transaksi ${receiptNo}?`)) {
      await db.sales.update(id, { status: 'cancel_requested' }); 
      await enqueueSync('UPDATE', 'sales', { id, status: 'cancel_requested' });
      await logAudit(role, 'Pengajuan Batal', `Mengajukan pembatalan transaksi ${receiptNo}`); 
      alert("Pengajuan pembatalan berhasil dikirim.");
    }
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex gap-2 overflow-x-auto bg-slate-50">
        <button onClick={() => setFilter('sales')} className={`px-4 py-2 rounded-lg font-black text-xs ${filter === 'sales' ? 'bg-[#DC2626] text-white shadow-sm' : 'bg-white text-slate-500 border'}`}>Riwayat Penjualan (Kasir)</button>
        {(role === 'Inventory' || role === 'Admin') && <button onClick={() => setFilter('purchases')} className={`px-4 py-2 rounded-lg font-black text-xs ${filter === 'purchases' ? 'bg-[#DC2626] text-white shadow-sm' : 'bg-white text-slate-500 border'}`}>Riwayat PO & Inbound</button>}
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left min-w-[600px] border-collapse"><thead className="bg-slate-50 text-[10px] font-black uppercase sticky top-0"><tr><th className="p-4 border-b">Waktu</th><th className="p-4 border-b">Referensi</th><th className="p-4 border-b">Total (Rp)</th><th className="p-4 border-b text-center">Status</th>{filter === 'sales' && role === 'Kasir' && <th className="p-4 border-b text-center">Aksi</th>}</tr></thead>
        <tbody className="text-xs font-bold text-[#1E293B] divide-y divide-[#E2E8F0]">
          {(filter === 'sales' ? sales : purchases).map((item: any) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="p-4 text-slate-500">{formatDate(item.date, true)}</td>
              <td className="p-4"><span className="text-red-600 font-black">{item.receiptNumber || item.receipt_number || item.poNumber || item.po_number}</span></td>
              <td className="p-4">{formatRp(item.total)}</td>
              <td className="p-4 text-center">
                  {item.status === 'completed' || item.status === 'approved' || item.status === 'received' ? <span className="text-green-700 bg-green-100 border border-green-200 px-2 py-1 rounded">Berhasil</span> : 
                   item.status === 'cancelled' || item.status === 'rejected' ? <span className="text-[#DC2626] bg-[#FEE2E2] border border-[#DC2626]/30 px-2 py-1 rounded">Dibatalkan/Ditolak</span> : 
                   item.status === 'cancel_requested' ? <span className="text-[#991B1B] bg-amber-100 border border-amber-300 px-2 py-1 rounded">Menunggu Batal</span> :
                   <span className="text-[#991B1B] bg-amber-100 border border-amber-300 px-2 py-1 rounded">Pending</span>}
              </td>
              {filter === 'sales' && role === 'Kasir' && <td className="p-4 text-center">{item.status === 'completed' && <button onClick={()=>requestCancel(item.id, item.receiptNumber || item.receipt_number)} className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-[10px] font-black shadow-sm">Batalkan</button>}</td>}
            </tr>
          ))}
        </tbody></table>
      </div>
    </div>
  )
}

function Approvals({ sales, purchases, adjustments, stockOpnames, shifts, products, role }: any) {
  if (role !== 'Admin') return null;
  const pendingCancels = sales.filter((s:any) => s.status === 'cancel_requested');
  const pendingPO = purchases.filter((p:any) => p.status === 'pending');
  const pendingOpname = stockOpnames.filter((so:any) => so.status === 'pending');
  const pendingShifts = shifts.filter((s:any) => s.status === 'pending_verification');

  const approve = async (type: string, obj: any, accept: boolean) => {
    try {
      await db.transaction('rw', db.sales, db.purchases, db.stock_opnames, db.shifts, db.products, db.product_batches, db.audit_logs, db.sync_queue, async () => {
        if (type === 'cancel') {
          await db.sales.update(obj.id, { status: accept ? 'cancelled' : 'completed' });
          await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'sales', payload: { id: obj.id, status: accept ? 'cancelled' : 'completed' }, created_at: new Date().toISOString() });
          if(accept) { 
             for(const i of obj.items) { 
               const p = await db.products.get(i.productId || i.product_id); 
               if(p) {
                  await db.products.update(p.id, { stock: p.stock + i.qty }); 
                  await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'products', payload: { id: p.id, stock: p.stock + i.qty }, created_at: new Date().toISOString() });
               } 
             } 
          }
        } else if (type === 'po') {
          await db.purchases.update(obj.id, { status: accept ? 'approved' : 'rejected' });
          await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'purchases', payload: { id: obj.id, status: accept ? 'approved' : 'rejected' }, created_at: new Date().toISOString() });
        } else if (type === 'opname') {
          await db.stock_opnames.update(obj.id, { status: accept ? 'approved' : 'rejected' });
          await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'stock_opnames', payload: { id: obj.id, status: accept ? 'approved' : 'rejected' }, created_at: new Date().toISOString() });
          if (accept) { 
             for (const item of obj.items) { 
                if (item.variance !== 0) { 
                   const prod = await db.products.get(item.productId || item.product_id); 
                   if (prod) { 
                     if (item.variance < 0) {
                        let needed = Math.abs(item.variance);
                        const prodBatches = await db.product_batches.where('productId').equals(prod.id).toArray();
                        const activeBatches = prodBatches.filter(b => b.qty > 0 && b.condition === 'Baik').sort((a,b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
                        for (const b of activeBatches) {
                           if (needed <= 0) break;
                           const take = Math.min(b.qty, needed); needed -= take;
                           await db.product_batches.update(b.id, { qty: b.qty - take });
                           await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'product_batches', payload: { id: b.id, qty: b.qty - take }, created_at: new Date().toISOString() });
                        }
                     } else if (item.variance > 0) {
                        const newBatch = {
                           id: generateUUID(), product_id: prod.id, batch_number: `OPN-${Date.now().toString().slice(-6)}`,
                           qty: item.variance, initial_qty: item.variance, hpp: prod.hpp,
                           received_date: new Date().toISOString().split('T')[0],
                           expiry_date: new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0],
                           condition: 'Baik'
                        };
                        await db.product_batches.add({...newBatch, productId: newBatch.product_id, batchNumber: newBatch.batch_number, initialQty: newBatch.initial_qty, receivedDate: newBatch.received_date, expiryDate: newBatch.expiry_date, createdAt: new Date().toISOString()});
                        await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'product_batches', payload: newBatch, created_at: new Date().toISOString() });
                     }
                     const updatedBatches = await db.product_batches.where('productId').equals(prod.id).toArray();
                     const newStock = updatedBatches.filter(b => b.condition === 'Baik').reduce((sum, b) => sum + b.qty, 0);
                     await db.products.update(prod.id, { stock: newStock }); 
                     await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'products', payload: { id: prod.id, stock: newStock }, created_at: new Date().toISOString() });
                   } 
                } 
             } 
          }
        } else if (type === 'shift') {
          await db.shifts.update(obj.id, { status: accept ? 'verified' : 'rejected' });
          await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'shifts', payload: { id: obj.id, status: accept ? 'verified' : 'rejected' }, created_at: new Date().toISOString() });
        }
        
        const logId = generateUUID();
        const auditPayload = { id: logId, timestamp: new Date().toISOString(), role: 'Admin', action: `Approval ${type}`, details: `Aksi: ${accept ? 'Disetujui' : 'Ditolak'}` };
        await db.audit_logs.add(auditPayload);
        await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'audit_logs', payload: auditPayload, created_at: new Date().toISOString() });
      });
      triggerPushSync();
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
              <button onClick={()=>approve(type, d, false)} className="px-4 py-2 bg-slate-50 border text-slate-800 rounded-lg font-black text-xs transition">Tolak / Klarifikasi</button>
              <button onClick={()=>approve(type, d, true)} className="px-4 py-2 bg-[#DC2626] text-white rounded-lg font-black text-xs shadow-md transition">Setujui & Valid</button>
           </div>
         </li>
       ))}</ul>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <CardList title="Verifikasi Setoran Uang Tutup Shift" data={pendingShifts} type="shift" renderItem={(d:any) => <div className="text-sm font-bold text-red-600">Shift: {d.shiftNumber} ({d.cashierName}) <br/><span className="text-xs text-slate-500 font-bold block mt-1">Uang Seharusnya: {formatRp(d.expectedCash || d.expected_cash)} | Uang Disetor: {formatRp(d.physicalCash || d.physical_cash)} <br/> Selisih: {formatRp(d.variance)}</span></div>} />
      <CardList title="Pengajuan Batal Transaksi (Kasir)" data={pendingCancels} type="cancel" renderItem={(d:any) => <div className="text-sm font-bold">TRX: {d.receiptNumber || d.receipt_number} <span className="text-[#DC2626] ml-2 block sm:inline">{formatRp(d.total)}</span><p className="text-[10px] font-bold text-[#64748B] mt-1">{formatDate(d.date, true)}</p></div>} />
      <CardList title="Pengajuan Purchase Order (PO) Gudang" data={pendingPO} type="po" renderItem={(d:any) => <div className="text-sm font-bold">PO: {d.poNumber || d.po_number} (Supplier: {d.supplier})<span className="text-[#64748B] block text-xs mt-1">{d.items[0]?.name} (Qty: {d.items[0]?.qty}) - Total: {formatRp(d.total)}</span></div>} />
      <CardList title="Pengajuan Berita Acara Stock Opname" data={pendingOpname} type="opname" renderItem={(d:any) => <div className="text-sm font-bold">Opname Tanggal: {formatDate(d.date, true)}<span className="text-[#64748B] block text-xs mt-1">Total Item Diperiksa: {d.items.length} item</span></div>} />
    </div>
  );
}

function Expenses({ expenses, role, loggedInUserId }: any) {
  if (role !== 'Admin') return null;
  const [desc, setDesc] = useState(''); const [amount, setAmount] = useState('');
  const save = async (e: React.FormEvent) => { 
    e.preventDefault(); 
    const ex = {id:generateUUID(), date:new Date().toISOString(), description:desc, amount:Number(amount), created_by: loggedInUserId};
    await db.expenses.add(ex); 
    await enqueueSync('INSERT', 'expenses', ex);
    await logAudit('Admin', 'Biaya Operasional', `Mencatat biaya: ${desc}`); 
    setDesc(''); setAmount(''); 
  };
  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit">
        <div className="flex items-center gap-3 mb-6"><DollarSign className="text-[#DC2626]"/><h3 className="font-black text-[#1E293B] text-lg">Catat Biaya Baru</h3></div>
        <form onSubmit={save} className="space-y-4">
          <div><label className="block text-xs font-black text-[#64748B] mb-2">Keperluan / Deskripsi</label><input required type="text" placeholder="Misal: Beli Plastik, Listrik..." value={desc} onChange={e=>setDesc(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold bg-[#F8FAFC] outline-none" /></div>
          <div><label className="block text-xs font-black text-[#64748B] mb-2">Jumlah Biaya (Rp)</label><input required type="number" placeholder="Nominal" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl font-bold bg-[#F8FAFC] outline-none" /></div>
          <button type="submit" className="w-full bg-[#DC2626] text-white py-3.5 rounded-xl font-black shadow-md transition">Simpan Pengeluaran</button>
        </form>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
        <h3 className="font-black text-[#1E293B] text-lg mb-6">Riwayat Biaya</h3>
        <ul className="space-y-3">{expenses.map((ex:any) => (<li key={ex.id} className="flex flex-col sm:flex-row justify-between sm:items-center font-bold text-sm bg-slate-50 border p-4 rounded-xl gap-2"><div><span className="text-[#1E293B]">{ex.description}</span><p className="text-[10px] text-slate-500 mt-1">{formatDate(ex.date, true)}</p></div><span className="text-red-600 bg-red-50 px-3 py-1.5 rounded-lg text-right">{formatRp(ex.amount)}</span></li>))}</ul>
      </div>
    </div>
  )
}

function AuditTrail({ logs, role }: any) {
  if (role !== 'Admin') return null;
  return (
    <div className="bg-white rounded-2xl border shadow-sm h-[calc(100vh-10rem)] flex flex-col overflow-hidden">
       <div className="p-4 bg-white border-b"><h3 className="font-black flex items-center gap-2"><Search size={18} className="text-red-600"/> Riwayat Aktivitas Sistem</h3></div>
       <div className="flex-1 overflow-auto custom-scrollbar">
         <table className="w-full text-left text-xs min-w-[500px] border-collapse"><thead className="bg-slate-50 text-[10px] font-black uppercase sticky top-0 border-b"><tr><th className="p-4">Waktu Terjadi</th><th className="p-4">Peran</th><th className="p-4">Aktivitas / Detail</th></tr></thead>
         <tbody className="font-bold divide-y">{logs.map((l:any) => (<tr key={l.id} className="hover:bg-slate-50"><td className="p-4 text-slate-500 font-mono">{new Date(l.timestamp).toLocaleString('id-ID')}</td><td className="p-4"><span className="bg-slate-800 text-white px-2 py-1 rounded text-[10px]">{l.role}</span></td><td className="p-4">{l.action}: <span className="text-slate-500 font-normal ml-1">{l.details}</span></td></tr>))}</tbody></table>
       </div>
    </div>
  )
}

function Reports({ products, sales, expenses, role }: any) {
  if (role !== 'Admin') return null;
  const handleExportDetailed = async () => {
    const completedSales = sales.filter((s: any) => s.status === 'completed');
    const productSalesMap: { [key: string]: { name: string; qty: number; revenue: number; profit: number } } = {};
    completedSales.forEach((sale: any) => {
      sale.items?.forEach((item: any) => {
        const pId = item.productId || item.product_id;
        if (!productSalesMap[pId]) productSalesMap[pId] = { name: item.name, qty: 0, revenue: 0, profit: 0 };
        productSalesMap[pId].qty += item.qty; productSalesMap[pId].revenue += item.subtotal;
        productSalesMap[pId].profit += (item.subtotal - ((item.hpp || 0) * item.qty));
      });
    });
    const productSalesList = Object.values(productSalesMap);
    const wb = XLSX.utils.book_new();

    const totalOmzet = completedSales.reduce((sum: number, x: any) => sum + x.total, 0);
    const totalHppAll = completedSales.reduce((sum: number, x: any) => sum + (x.hppTotal || x.hpp_total || 0), 0);
    const totalBiayaOp = expenses.reduce((sum: number, x: any) => sum + x.amount, 0);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["LAPORAN KEUANGAN GERAI KMP PKT"], ["Tanggal Cetak:", new Date().toLocaleString('id-ID')], [], ["PENGUKURAN KEUANGAN", "NOMINAL (IDR)"], ["Total Transaksi Sukses", completedSales.length], ["Total Omzet", totalOmzet], ["Total HPP", totalHppAll], ["Laba Kotor", totalOmzet - totalHppAll], ["Total Biaya Operasional", totalBiayaOp], ["Laba Bersih Operasional", (totalOmzet - totalHppAll) - totalBiayaOp]]), "Ringkasan Laba Rugi");
    const productRows: any[][] = [["RINCIAN PENJUALAN PER PRODUK"], [], ["Nama Produk", "Total Terjual (Qty)", "Total Omzet (Rp)", "Estimasi Laba (Rp)"]]; 
    productSalesList.forEach(p => productRows.push([p.name, String(p.qty), String(p.revenue), String(p.profit)]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(productRows), "Rincian Produk Terjual");
    const salesRows: any[][] = [["DAFTAR TRANSAKSI PENJUALAN SUKSES"], [], ["No. Struk", "Waktu", "Metode Pembayaran", "Total (Rp)", "Laba (Rp)"]]; 
    completedSales.forEach((s: any) => salesRows.push([s.receiptNumber || s.receipt_number, new Date(s.date).toLocaleString('id-ID'), s.paymentMethod || s.payment_method, String(s.total), String(s.profit || 0)]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salesRows), "Daftar Transaksi");
    XLSX.writeFile(wb, `Laporan_Gerai_KMP_PKT_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="max-w-xl mx-auto text-center mt-12 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
      <FileSpreadsheet size={48} className="mx-auto text-red-600 mb-4"/><h2 className="text-xl font-black mb-2 text-slate-800">Laporan Keuangan & Operasional Lengkap</h2>
      <p className="text-slate-500 text-xs font-bold mb-8">File Excel yang dihasilkan mencakup multi-tab: <br/><span className="text-red-600">Ringkasan Laba Rugi, Rincian Barang Terjual, Daftar Transaksi, hingga Biaya Operasional.</span></p>
      <button onClick={handleExportDetailed} className="w-full bg-slate-800 hover:bg-black text-white py-4 rounded-xl font-black shadow-md transition flex items-center justify-center gap-2"><Download size={18}/> Unduh Laporan Excel Komprehensif (.xlsx)</button>
    </div>
  );
}

function SettingsView({ role, appLogoUrl }: any) {
  if (role !== 'Admin') return null;
  const handleLogoUpload = async (e: any) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 1024 * 1024) return alert("Ukuran logo maksimal 1MB.");
      const reader = new FileReader();
      reader.onload = async (ev) => {
        await db.settings.put({ id: 'appLogo', value: ev.target?.result as string });
        alert("Logo berhasil diperbarui!");
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border">
        <h2 className="font-black text-lg mb-2 flex items-center gap-2"><ImageIcon className="text-[#DC2626]"/> Pengaturan Identitas Aplikasi</h2>
        <p className="text-slate-500 text-xs font-bold mb-6">Ubah logo Koperasi yang akan ditampilkan di aplikasi dan dokumen cetak.</p>
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-full border-4 border-slate-100 flex items-center justify-center bg-slate-50 overflow-hidden shadow-inner">
            {appLogoUrl ? <img src={appLogoUrl} alt="Logo" className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-slate-400 text-center px-2">Belum ada logo</span>}
          </div>
          <div>
            <label className="cursor-pointer bg-slate-800 hover:bg-black text-white px-4 py-2.5 rounded-xl text-xs font-black shadow-md transition inline-block">Pilih File Logo...<input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} /></label>
            <p className="text-[10px] text-slate-500 mt-2 font-bold">*Format: PNG, JPG (Maks. 1MB)</p>
          </div>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl shadow-sm border">
         <h2 className="font-black text-lg mb-2 flex items-center gap-2"><Database className="text-red-600"/> Arsitektur Sinkronisasi Aktif</h2>
         <p className="text-slate-500 text-xs font-bold">Saat ini, Anda tidak perlu melakukan Backup & Restore manual ke JSON karena aplikasi secara otomatis mencadangkan datanya melalui Supabase Cloud Sync secara Background (Latar Belakang).</p>
      </div>
    </div>
  )
}
