import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Dexie, { Table } from 'dexie';
import \* as XLSX from 'xlsx';
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
products!: Table;
product_batches!: Table;
sales!: Table;
purchases!: Table;
expenses!: Table;
adjustments!: Table;
stock_opnames!: Table;
cash_registers!: Table;
audit_logs!: Table;
settings!: Table;
members!: Table;
shifts!: Table;
min_stock_settings!: Table;
sync_queue!: Table;

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
return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/\[xy\]/g, c => {
const r = Math.random() \* 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
return v.toString(16);
});
};

// ==================== SYNC ENGINE (OFFLINE-FIRST) ====================
let isSyncingProcess = false;

// 0. Mapper: Mencegah undefined dengan mengubah snake_case (Supabase) ke camelCase (Dexie)
const mapToLocal = (data: any) => {
if (!data) return data;
const mapped = { ...data };
const mapKey = (snake: string, camel: string) => {
if (mapped\[snake\] !== undefined) { mapped\[camel\] = mapped\[snake\]; delete mapped\[snake\]; }
};

mapKey('member_price', 'memberPrice'); mapKey('min_stock', 'minStock'); mapKey('is_archived', 'isArchived');
mapKey('product_id', 'productId'); mapKey('batch_number', 'batchNumber'); mapKey('initial_qty', 'initialQty');
mapKey('received_date', 'receivedDate'); mapKey('expiry_date', 'expiryDate'); mapKey('no_induk', 'noInduk');
mapKey('join_date', 'joinDate'); mapKey('credit_balance', 'creditBalance'); mapKey('shift_number', 'shiftNumber');
mapKey('start_time', 'startTime'); mapKey('end_time', 'endTime'); mapKey('opening_balance', 'openingBalance');
mapKey('expected_cash', 'expectedCash'); mapKey('physical_cash', 'physicalCash'); mapKey('cash_details', 'cashDetails');
mapKey('receipt_number', 'receiptNumber'); mapKey('shift_id', 'shiftId'); mapKey('member_id', 'memberId');
mapKey('cashier_id', 'cashierId'); mapKey('hpp_total', 'hppTotal'); mapKey('payment_method', 'paymentMethod');
mapKey('payment_received', 'paymentReceived'); mapKey('po_number', 'poNumber');

// Map relasi nested items jika ada (seperti sale_items, purchase_items)
if (mapped.items && Array.isArray(mapped.items)) {
mapped.items = mapped.items.map((item: any) => mapToLocal(item));
}
return mapped;
};

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

```
for (const item of queue) {
  try {
    let success = false;
    let sbError: any = null;

    // PERBAIKAN: Direct Insert tanpa RPC untuk menghindari error unhandled
    if (item.table_name === 'sales' && item.operation === 'INSERT') {
      const { items, receiptNumber, shiftId, cashierRole, ...saleData } = item.payload; // Buang properti lokal
      const { error } = await supabase.from('sales').insert(saleData);
      if (!error || error.code === '23505') {
        if (items && items.length > 0) {
          const saleItems = items.map((i:any) => ({ sale_id: saleData.id, product_id: i.productId || i.product_id, name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal, hpp: i.hpp, unit: i.unit }));
          await supabase.from('sale_items').insert(saleItems);
        }
        success = true;
      } else sbError = error;
      
    } else if (item.table_name === 'purchases' && item.operation === 'INSERT') {
      const { items, poNumber, ...poData } = item.payload; // Buang properti lokal
      const { error } = await supabase.from('purchases').insert(poData);
      if (!error || error.code === '23505') {
        if (items && items.length > 0) {
          const poItems = items.map((i:any) => ({ purchase_id: poData.id, product_id: i.productId || i.product_id, name: i.name, qty: i.qty, price: i.price, total: i.total }));
          await supabase.from('purchase_items').insert(poItems);
        }
        success = true;
      } else sbError = error;

    } else if (item.table_name === 'stock_opnames' && item.operation === 'INSERT') {
      const { items, ...opnameData } = item.payload;
      const { error } = await supabase.from('stock_opnames').insert(opnameData);
      if (!error || error.code === '23505') {
        if (items && items.length > 0) {
          const opItems = items.map((i:any) => ({ opname_id: opnameData.id, product_id: i.productId || i.product_id, product_name: i.productName, system_stock: i.systemStock, physical_stock: i.physicalStock, variance: i.variance, reason: i.reason }));
          await supabase.from('stock_opname_items').insert(opItems);
        }
        success = true;
      } else sbError = error;
    } else {
      if (item.operation === 'INSERT') {
        const { error } = await supabase.from(item.table_name).insert(item.payload);
        if (!error || error.code === '23505') success = true; else sbError = error;
      } else if (item.operation === 'UPDATE') {
        const { error } = await supabase.from(item.table_name).update(item.payload).eq('id', item.payload.id);
        if (!error) success = true; else sbError = error;
      } else if (item.operation === 'DELETE') {
        const { error } = await supabase.from(item.table_name).delete().eq('id', item.payload.id);
        if (!error) success = true; else sbError = error;
      }
    }

    if (success) {
      await db.sync_queue.delete(item.id);
    } else if (sbError) {
      console.error(`Supabase Sync Error [${item.table_name}]:`, sbError);
      if (sbError.code && !sbError.code.startsWith('08') && !sbError.code.startsWith('53')) {
          await db.sync_queue.delete(item.id);
          console.warn(`Dropped corrupted payload for ${item.table_name} to prevent infinite loop.`);
      }
    }
  } catch (err: any) { 
    console.error(`Runtime crash on sync ${item.table_name}:`, err);
    await db.sync_queue.delete(item.id);
  }
}

```

} finally { isSyncingProcess = false; }
};

export const startRealtimeSync = () => {
const tables = \['products', 'product_batches', 'members', 'expenses', 'purchases', 'sales', 'shifts', 'stock_opnames', 'audit_logs'\];
tables.forEach(table => {
supabase.channel(`public:${table}`).on('postgres_changes', { event: '\*', schema: 'public', table: table }, async (payload) => {
if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
let data = payload.new as any;

```
      // PERBAIKAN: Anti Race-Condition (Jeda penarikan relasi data untuk memberi waktu server bernapas)
      if (['purchases', 'sales', 'stock_opnames'].includes(table)) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (table === 'purchases') {
        const res = await supabase.from('purchases').select('*, items:purchase_items(*)').eq('id', data.id).single();
        if (res.data) data = res.data;
      } else if (table === 'sales') {
        const res = await supabase.from('sales').select('*, items:sale_items(*)').eq('id', data.id).single();
        if (res.data) data = res.data;
      } else if (table === 'stock_opnames') {
        const res = await supabase.from('stock_opnames').select('*, items:stock_opname_items(*)').eq('id', data.id).single();
        if (res.data) data = res.data;
      }

      const mappedData = mapToLocal(data);

      if (table === 'products') await db.products.put(mappedData);
      if (table === 'product_batches') await db.product_batches.put(mappedData);
      if (table === 'members') await db.members.put(mappedData);
      if (table === 'expenses') await db.expenses.put(mappedData);
      if (table === 'shifts') await db.shifts.put(mappedData);
      if (table === 'audit_logs') await db.audit_logs.put(mappedData);
      if (table === 'purchases') await db.purchases.put(mappedData);
      if (table === 'sales') await db.sales.put(mappedData);
      if (table === 'stock_opnames') await db.stock_opnames.put(mappedData);
  }
}).subscribe();

```

});
};

const logAudit = async (role: string, action: string, details: string) => {
const payload = { id: generateUUID(), timestamp: new Date().toISOString(), role, action, details };
await db.audit_logs.add(payload);
await enqueueSync('INSERT', 'audit_logs', payload);
};

export const calculateProductStats = async (productId: string, settings: MinStockSetting) => {
const periodMs = settings.periodDays \* 24 \* 60 \* 60 \* 1000;
const cutoffDate = new Date(Date.now() - periodMs).toISOString();
const allSales = await db.sales.where('date').aboveOrEqual(cutoffDate).toArray();
const validSales = allSales.filter(s => s.status === 'completed');
let totalUnitsSold = 0;
validSales.forEach(sale => { const item = sale.items?.find((i: any) => i.productId === productId); if (item) totalUnitsSold += item.qty; });
const dailyAverage = totalUnitsSold / settings.periodDays;
let minStock = 0;
if (settings.calculationMethod === 'percentage') minStock = Math.ceil(dailyAverage \* settings.periodDays \* (settings.percentage / 100));
else minStock = Math.ceil((dailyAverage \* settings.leadTimeDays) + settings.safetyStock);

const today = new Date().toISOString().split('T')\[0\];
const batches = await db.product_batches.where('productId').equals(productId).toArray();
const sellableStock = batches.filter(b => b.condition === 'Baik' && (!b.expiryDate || b.expiryDate >= today)).reduce((sum, b) => sum + b.qty, 0);

const pendingPurchases = await db.purchases.filter(p => p.status === 'approved').toArray();
let stockInTransit = 0;
pendingPurchases.forEach(po => { const item = po.items?.find((i: any) => i.productId === productId); if (item) stockInTransit += item.qty; });

let status = 'Data Belum Mencukupi';
if (totalUnitsSold > 0) {
if (sellableStock <= 0) status = 'Di Bawah Stok Minimum'; else if (sellableStock < minStock) status = 'Di Bawah Stok Minimum';
else if (sellableStock === minStock) status = 'Stok Minimum Tercapai'; else if (sellableStock <= minStock \* 1.2) status = 'Mendekati Stok Minimum';
else status = 'Aman';
}
const targetStock = minStock > 0 ? (minStock \* 2) : 10;
const recommendedOrder = Math.max(0, targetStock - sellableStock - stockInTransit);
return { totalUnitsSold, dailyAverage, minStock, sellableStock, stockInTransit, status, recommendedOrder, calculationMethod: settings.calculationMethod };
};

export default function App() {
const \[loggedInRole, setLoggedInRole\] = useState<string | null>(null);
const \[loggedInName, setLoggedInName\] = useState<string | null>(null);
const \[loggedInUserId, setLoggedInUserId\] = useState<string | null>(null);
const \[isInitializing, setIsInitializing\] = useState(true);
const \[activeTab, setActiveTab\] = useState('dashboard');
const \[isMobileMenuOpen, setIsMobileMenuOpen\] = useState(false);

const \[isOnline, setIsOnline\] = useState(navigator.onLine);
const \[syncItemsCount, setSyncItemsCount\] = useState(0);

const products = useLiveQuery(() => db.products.toArray(), \[\]) || \[\];
const batches = useLiveQuery(() => db.product_batches.toArray(), \[\]) || \[\];
const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().toArray(), \[\]) || \[\];
const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().toArray(), \[\]) || \[\];
const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), \[\]) || \[\];
const adjustments = useLiveQuery(() => db.adjustments.orderBy('date').reverse().toArray(), \[\]) || \[\];
const stockOpnames = useLiveQuery(() => db.stock_opnames.orderBy('date').reverse().toArray(), \[\]) || \[\];
const auditLogs = useLiveQuery(() => db.audit_logs.orderBy('timestamp').reverse().toArray(), \[\]) || \[\];
const members = useLiveQuery(() => db.members.toArray(), \[\]) || \[\];
const shifts = useLiveQuery(() => db.shifts.orderBy('startTime').reverse().toArray(), \[\]) || \[\];

const globalMinStockSettingRaw = useLiveQuery(() => db.min_stock_settings.get('global'), \[\]);
const appLogoRaw = useLiveQuery(() => db.settings.get('appLogo'), \[\]);
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

```
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

```

}, \[\]);

useEffect(() => {
if (loggedInRole && isOnline) {
const pullInitialData = async () => {
const fetchQueries = \[
{ table: 'products', query: '*' },
{ table: 'product_batches', query: '*' },
{ table: 'members', query: '*' },
{ table: 'expenses', query: '*' },
{ table: 'shifts', query: '*' },
{ table: 'audit_logs', query: '*' },
{ table: 'purchases', query: '*, items:purchase_items(*)' },
{ table: 'sales', query: '*, items:sale_items(*)' },
{ table: 'stock_opnames', query: '*, items:stock_opname_items(*)' }
\];

```
    for (const { table, query } of fetchQueries) {
      const { data, error } = await supabase.from(table).select(query);
      if (data && !error) {
        const mappedData = data.map(d => mapToLocal(d));
        await db.table(table).bulkPut(mappedData); 
      }
    }
  };
  
  pullInitialData().then(() => {
    startRealtimeSync();
    triggerPushSync();
  });
}

```

}, \[loggedInRole, isOnline\]);

if (isInitializing) return Menghubungkan ke Sistem Keamanan Cloud...;

const globalMinStockSetting = globalMinStockSettingRaw || { id: 'global', type: 'global', periodDays: 30, percentage: 50, leadTimeDays: 3, safetyStock: 10, calculationMethod: 'percentage' };

if (!loggedInRole) return <LoginScreen appLogoUrl={appLogoUrl} onLogin={(role: any, name: string, userId: string) => { setLoggedInRole(role); setLoggedInName(name); setLoggedInUserId(userId); setActiveTab('dashboard'); logAudit(role, 'Login', `Berhasil masuk: ${name}`); }} />;

const handleLogout = async () => {
if (loggedInRole) await logAudit(loggedInRole, 'Logout', 'Keluar dari sistem');
await supabase.auth.signOut();
};
const activeShift = shifts.find((s:any) => s.status === 'open');

const navItems = \[
{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: \['Kasir', 'Inventory', 'Admin'\] },
{ id: 'pos', label: 'Kasir & Transaksi', icon: ShoppingCart, roles: \['Kasir'\] },
{ id: 'members', label: 'Data Anggota', icon: Users, roles: \['Admin'\] },
{ id: 'shift_management', label: 'Tutup Kas Harian', icon: Wallet, roles: \['Kasir'\] },
{ id: 'products', label: 'Data Persediaan', icon: Package, roles: \['Inventory', 'Admin'\] },
{ id: 'min_stock_settings', label: 'Pengaturan Stok Min', icon: Sliders, roles: \['Admin', 'Inventory'\] },
{ id: 'purchase_orders', label: 'Purchase Order (PO)', icon: ClipboardList, roles: \['Inventory', 'Admin'\] },
{ id: 'inbound', label: 'Penerimaan Barang', icon: ArrowDownToLine, roles: \['Inventory'\] },
{ id: 'stock_opname', label: 'Stock Opname', icon: ClipboardCheck, roles: \['Inventory', 'Admin'\] },
{ id: 'history', label: 'Riwayat Transaksi', icon: History, roles: \['Kasir', 'Inventory', 'Admin'\] },
{ id: 'approvals', label: 'Persetujuan (Admin)', icon: ShieldCheck, roles: \['Admin'\] },
{ id: 'expenses', label: 'Biaya Operasional', icon: DollarSign, roles: \['Admin'\] },
{ id: 'reports', label: 'Laporan & Excel', icon: FileSpreadsheet, roles: \['Admin'\] },
{ id: 'audit', label: 'Jejak Audit', icon: Search, roles: \['Admin'\] },
{ id: 'settings', label: 'Pengaturan Sistem', icon: Settings, roles: \['Admin'\] },
\];

const pendingApprovalsCount = sales.filter((s:any) => s.status === 'cancel_requested').length + purchases.filter((p:any) => p.status === 'pending').length + stockOpnames.filter((so:any) => so.status === 'pending').length + shifts.filter((s:any) => s.status === 'pending_verification').length;

const renderContent = () => {
switch (activeTab) {
case 'dashboard': return ;
case 'pos': return activeShift ?  : ;
case 'members': return ;
case 'shift_management': return ;
case 'products': return ;
case 'min_stock_settings': return ;
case 'purchase_orders': return ;
case 'inbound': return ;
case 'stock_opname': return ;
case 'history': return ;
case 'approvals': return ;
case 'expenses': return ;
case 'reports': return ;
case 'audit': return ;
case 'settings': return ;
default: return ;
}
};

return (



{appLogoUrl ?  : } Gerai KMP PKT

<button onClick={() => setIsMobileMenuOpen(true)} className="p-2">

```
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

```

);
}

function LoginScreen({ onLogin, appLogoUrl }: any) {
const \[email, setEmail\] = useState(''); const \[password, setPassword\] = useState('');
const \[showPassword, setShowPassword\] = useState(false); const \[error, setError\] = useState(''); const \[isLoading, setIsLoading\] = useState(false);

const handleLogin = async (e: React.FormEvent) => {
e.preventDefault(); setError(''); setIsLoading(true);
try {
if (!navigator.onLine) throw new Error("Anda sedang offline. Koneksi internet diperlukan untuk login pertama kali.");
const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) throw authError;

```
  const { data: profile, error: profileError } = await supabase.from('users').select('*').eq('id', data.user.id).single();
  if (profileError || !profile) throw new Error("Gagal memuat profil. Akun Anda mungkin tidak memiliki izin RLS.");
  if (!profile.is_active) throw new Error("Akses Ditolak. Akun dinonaktifkan oleh Admin.");

  await db.settings.put({ id: 'local_profile', value: profile });
  onLogin(profile.role, profile.full_name, data.user.id);
} catch (err: any) { setError(err.message || 'Gagal masuk. Periksa kembali email dan password Anda.'); } finally { setIsLoading(false); }

```

};

return (




{appLogoUrl ?  : }

GERAI KMP PKT
Sistem POS & Inventory Cloud

{error &&  {error}}


Email Pengguna
<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@koperasi.com" required className="w-full border-2 border-\[#E2E8F0\] rounded-xl p-3 focus:outline-none focus:border-\[#DC2626\] bg-white font-bold text-\[#1E293B\] text-sm" />


Password

<input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan password" required className="w-full border-2 border-\[#E2E8F0\] rounded-xl p-3 pr-12 focus:outline-none focus:border-\[#DC2626\] font-bold text-\[#1E293B\] text-sm" />
<button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-\[#64748B\] hover:text-\[#DC2626\]">{showPassword ?  : }



{isLoading ? 'Memverifikasi...' : 'Login Ke Sistem'}




);
}

function Dashboard({ products, batches, sales, role, purchases, shifts, stockOpnames, members, globalMinStockSetting }: any) {
const \[analyticsData, setAnalyticsData\] = useState<any\[\]>(\[\]);
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
}, \[activeProducts, sales, batches, purchases, globalMinStockSetting, role\]);

const completedSales = sales.filter((s: any) => s.status === 'completed');
const today = new Date().toISOString().split('T')\[0\];
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
<div className={`p-4 rounded-xl bg-[#FEE2E2] text-[#DC2626]`}>
{title}{value}{sub && {sub}}

);

return (

{role === 'Kasir' && 
<StatCard title="Status Shift" value={activeShift ? `Aktif (${activeShift.shiftNumber})` : 'Belum Buka Shift'} icon={activeShift ? Wallet : AlertTriangle} alertClass={activeShift ? 'border-green-400 bg-green-50/20' : 'border-red-400 bg-red-50/20'} />

}

```
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

```

);
}

function MinStockSettingsView({ globalSetting, role }: any) {
if (role !== 'Admin' && role !== 'Inventory') return null;
const \[formData, setFormData\] = useState({ ...globalSetting });

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

 Pengaturan Global Stok Minimum OtomatisSistem akan menghitung rata-rata penjualan secara otomatis berdasarkan transaksi POS yang berhasil.

Periode Analisis Penjualan (Hari)<select value={formData.periodDays} onChange={e=>setFormData({...formData, periodDays: e.target.value})} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm outline-none focus:border-\[#DC2626\]">7 Hari Terakhir14 Hari Terakhir30 Hari Terakhir (1 Bulan)60 Hari Terakhir (2 Bulan)90 Hari Terakhir (3 Bulan)
Pilih Metode Perhitungan Utama

<input type="radio" name="calcMethod" value="percentage" checked={formData.calculationMethod === 'percentage'} onChange={() => setFormData({...formData, calculationMethod: 'percentage'})} className="mt-1" />Metode Persentase (Agresif)Stok Min = Rata-rata Harian × Hari Analisis × Persentase
<input type="radio" name="calcMethod" value="lead_time" checked={formData.calculationMethod === 'lead_time'} onChange={() => setFormData({...formData, calculationMethod: 'lead_time'})} className="mt-1" />Metode Lead Time & Safety Stock (Konservatif)Stok Min = (Rata-rata Harian × Lead Time Supplier) + Safety Stock


{formData.calculationMethod === 'percentage' && (Persentase Minimum (%)<input type="number" min="1" max="200" value={formData.percentage} onChange={e=>setFormData({...formData, percentage: e.target.value})} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm outline-none focus:border-\[#DC2626\]" />)}
{formData.calculationMethod === 'lead_time' && (Lead Time Supplier (Hari)<input type="number" min="1" value={formData.leadTimeDays} onChange={e=>setFormData({...formData, leadTimeDays: e.target.value})} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm outline-none focus:border-\[#DC2626\]" />Safety Stock (Buffer Unit)<input type="number" min="0" value={formData.safetyStock} onChange={e=>setFormData({...formData, safetyStock: e.target.value})} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm outline-none focus:border-\[#DC2626\]" />)}
Simpan Pengaturan Global


)
}

function OpenShift({ role, loggedInUserId }: any) {
const \[opening, setOpening\] = useState('');
const openShift = async (e:any) => {
e.preventDefault();
const shift = { id: generateUUID(), shiftNumber: generateId('SHF'), cashier_id: loggedInUserId, cashierName: role, startTime: new Date().toISOString(), openingBalance: Number(opening), status: 'open', notes: '' };
await db.shifts.add(shift);
await enqueueSync('INSERT', 'shifts', shift);
await logAudit(role, 'Buka Shift', `Shift ${shift.shiftNumber} modal awal: ${formatRp(shift.openingBalance)}`);
window.location.reload();
};
return (

Buka Shift KasirAnda wajib membuka shift sebelum mulai bertransaksi.

Modal Awal / Uang Kembalian (Rp)<input required type="number" min="0" value={opening} onChange={e=>setOpening(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold bg-slate-50 text-slate-800 outline-none focus:border-red-600" placeholder="0" />
Mulai Shift Sekarang


);
}

function CloseShift({ role, sales, activeShift, expenses }: any) {
if (role !== 'Kasir') return null;
if (!activeShift) return Tidak ada shift aktif.;

const \[denoms, setDenoms\] = useState({ d100k:0, d50k:0, d20k:0, d10k:0, d5k:0, d2k:0, d1k:0, coins:0 });
const calcPhys = () => (denoms.d100k*100000) + (denoms.d50k*50000) + (denoms.d20k*20000) + (denoms.d10k*10000) + (denoms.d5k*5000) + (denoms.d2k*2000) + (denoms.d1k\*1000) + (denoms.coins);

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


Ringkasan Penjualan Shift

Nomor Shift{activeShift.shiftNumber}
Modal Awal Laci{formatRp(activeShift.openingBalance)}
Penjualan Tunai+{formatRp(cashSales)}
Pengeluaran Kas Disetujui-{formatRp(shiftExpenses)}

Seharusnya Uang Tunai:{formatRp(expectedCash)}

Penjualan Non-Tunai (QRIS/Trf){formatRp(qrisSales+transferSales)}
Penjualan Kredit (Potong Gaji){formatRp(creditSales)}


```
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

```

)
}

function POS({ products, batches, role, members, activeShift, appLogoUrl, loggedInUserId }: any) {
if (role !== 'Kasir') return null;
const \[cart, setCart\] = useState<any\[\]>(\[\]); const \[searchTerm, setSearchTerm\] = useState('');
const \[customerType, setCustomerType\] = useState('Umum'); const \[selectedMember, setSelectedMember\] = useState('');
const \[payMethod, setPayMethod\] = useState('Tunai'); const \[payAmount, setPayAmount\] = useState('');
const \[receiptData, setReceiptData\] = useState(null); const \[isProcessing, setIsProcessing\] = useState(false);
const \[isCartOpen, setIsCartOpen\] = useState(false);

const filteredProds = products.filter((p:any) => !p.isArchived && p.stock>0 && (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase())));
const activeMember = members.find((m:any) => m.id === selectedMember);

// PERBAIKAN: Logika harga member yang ketat. Jika memberPrice null/undefined/0, ambil harga umum.
const addToCart = (prod: any) => {
const existing = cart.find(i => i.productId === prod.id);
if (existing) { if(existing.qty < prod.stock) setCart(cart.map(i => i.productId === prod.id ? {...i, qty: i.qty+1} : i)); }
else {
const finalMemberPrice = (prod.memberPrice !== undefined && prod.memberPrice !== null && prod.memberPrice > 0) ? prod.memberPrice : prod.price;
setCart(\[...cart, { productId: prod.id, name: prod.name, price: prod.price, memberPrice: finalMemberPrice, hpp: prod.hpp, qty: 1, unit: prod.unit, maxStock: prod.stock }\]);
}
};
const updateQty = (id:string, delta:number) => { setCart(cart.map(i => i.productId=id ? {...i, qty: Math.min(Math.max(1, i.qty+delta), i.maxStock)} : i)); };
const totalAmount = cart.reduce((sum, item) => sum + (item.qty \* (customerType='Anggota' ? item.memberPrice : item.price)), 0);
const change = (payMethod==='Tunai' && payAmount) ? Number(payAmount) - totalAmount : 0;

const handleCheckout = async () => {
if(cart.length=0 || isProcessing) return;
if(payMethod='Tunai' && change < 0) return alert('Pembayaran tunai kurang!');
if(payMethod==='Kredit' && customerType!=='Anggota') return alert('Hanya anggota yang bisa menggunakan kredit potong gaji.');

```
setIsProcessing(true);
try {
  const receiptNo = generateReceiptNumber(); let totalHpp = 0; let totalProfit = 0;
  const todayStr = new Date().toISOString().split('T')[0];
  const batchUpdates:any[] = []; const prodUpdates:any[] = []; const allocItems:any[] = [];

  for (const item of cart) {
    let needed = item.qty;
    // PERBAIKAN: Izinkan stok yang tidak memiliki tgl kedaluwarsa (null/undefined) (!b.expiryDate)
    const prodBatches = batches.filter((b:any) => b.productId===item.productId && b.qty>0 && b.condition==='Baik' && (!b.expiryDate || b.expiryDate>=todayStr)).sort((a:any, b:any) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime());
    let itemHpp = 0;
    for (const b of prodBatches) {
      if (needed <= 0) break;
      const take = Math.min(b.qty, needed);
      itemHpp += take * b.hpp; needed -= take;
      const exUpdate = batchUpdates.find(bu=>bu.id===b.id);
      if (exUpdate) exUpdate.qty -= take; else batchUpdates.push({id:b.id, qty: b.qty-take});
    }
    if (needed > 0) throw new Error(`Stok batch aktif produk ${item.name} tidak cukup/expired! Pastikan data Inbound sudah benar.`);
    
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

  await db.transaction('rw', [db.sales, db.products, db.product_batches, db.members, db.audit_logs, db.sync_queue], async () => {
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

```

};

if (receiptData) return (


{appLogoUrl ?  : }
GERAI KMP PKT
{receiptData.receipt_number}
{new Date(receiptData.date).toLocaleString('id-ID')}

{receiptData.items.map((item: any, idx: number) => ( {item.name}{item.qty} x {formatRp(item.price)}{formatRp(item.subtotal)} ))}

```
  <div className="text-sm font-black space-y-1 mb-4">
       <div className="flex justify-between"><span>TOTAL</span><span>{formatRp(receiptData.total)}</span></div>
       <div className="flex justify-between text-slate-500 text-xs"><span>Metode: {receiptData.payment_method}</span><span>Diterima: {formatRp(receiptData.payment_received)}</span></div>
       {receiptData.change > 0 && <div className="flex justify-between text-slate-500 text-xs"><span>Kembalian</span><span>{formatRp(receiptData.change)}</span></div>}
       {receiptData.member_id && <div className="mt-2 text-center text-[10px] bg-slate-100 p-1 rounded">Transaksi Member / Tambahan Poin Tersimpan</div>}
  </div>

  <div className="mt-6 flex gap-3 print:hidden"><button onClick={() => window.print()} className="flex-1 bg-[#F8FAFC] border-2 border-[#E2E8F0] text-[#1E293B] py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Printer size={16} /> Cetak</button><button onClick={() => setReceiptData(null)} className="flex-1 bg-[#DC2626] text-white py-3 rounded-xl font-bold shadow-md text-sm">Selesai</button></div>
  <style>{`@media print { body * { visibility: hidden; } #receipt-print, #receipt-print * { visibility: visible; } #receipt-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; border: none; } }`}</style>
</div></div>

```

);

return (


<input type="text" placeholder="Cari barang atau SKU..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-\[#E2E8F0\] focus:outline-none focus:border-\[#DC2626\] font-bold text-sm bg-\[#F8FAFC\]" />


{filteredProds.map((p: any) => (
<div key={p.id} onClick={() => addToCart(p)} className="bg-white border-2 border-\[#E2E8F0\] rounded-xl p-3 cursor-pointer hover:border-\[#DC2626\] transition flex flex-col shadow-sm">
Stok: {p.stock}
{p.name}
{customerType==='Anggota' && (p.memberPrice !== undefined && p.memberPrice !== null && p.memberPrice > 0) && p.memberPrice < p.price ?
{formatRp(p.price)}{formatRp(p.memberPrice)} :
{formatRp(p.price)}
}

))}



```
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

```

);
}

function Products({ products, batches, role }: any) {
const \[searchTerm, setSearchTerm\] = useState('');
const \[modalType, setModalType\] = useState<string | null>(null);
const \[formData, setFormData\] = useState({});
const \[showArchived, setShowArchived\] = useState(false);

const filtered = products.filter((p: any) => { if (!showArchived && p.isArchived) return false; return p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase()); });
const totalInventoryValue = products.filter((p:any) => !p.isArchived).reduce((acc: number, p: any) => { const pBatches = batches.filter((b:any) => b.productId === p.id && b.condition === 'Baik' && b.qty > 0); return acc + pBatches.reduce((sum:number, b:any) => sum + (b.qty \* b.hpp), 0); }, 0);

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



<input type="text" placeholder="Cari barang atau SKU..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-xl border-2 border-\[#E2E8F0\] focus:outline-none focus:border-\[#DC2626\] font-bold text-sm bg-\[#F8FAFC\]" />
<input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded" /> Tampilkan Arsip


{role === 'Admin' || role === 'Inventory' ? ( Nilai Persediaan: {formatRp(totalInventoryValue)} ) : null}
{role === 'Admin' && ( <button onClick={() => { setFormData({ id: null, sku: '', name: '', category: '', unit: 'Pcs', hpp: 0, price: 0, memberPrice: 0, minStock: 10 }); setModalType('edit'); }} className="w-full sm:w-auto bg-\[#DC2626\] hover:bg-\[#991B1B\] text-white px-5 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md text-sm"> Tambah )}




SKU & Nama Barang{role === 'Admin' && HPP}Harga UmumHarga AnggotaStok{(role === 'Inventory' || role === 'Admin') && Nilai Persediaan}Aksi

{filtered.map((p: any) => {
const pBatches = batches.filter((b:any) => b.productId === p.id && b.condition === 'Baik' && b.qty > 0); const pValue = pBatches.reduce((sum:number, b:any) => sum + (b.qty \* b.hpp), 0);
return (
<tr key={p.id} className={`hover:bg-[#F8FAFC] ${p.isArchived ? 'opacity-60 bg-slate-50' : ''}`}>
{p.sku} - {p.name} {p.isArchived && Diarsipkan}{p.category}
{role === 'Admin' && {formatRp(p.hpp)}}
{formatRp(p.price)}{formatRp(p.memberPrice || p.member_price)}<span className={`px-2 py-1 rounded text-[10px] ${p.stock <= (p.minStock ?? 10) ? 'bg-[#991B1B] text-white' : 'bg-[#E2E8F0] text-[#1E293B]'}`}>{p.stock} {p.unit}
{(role === 'Inventory' || role === 'Admin') && ( {formatRp(pValue)} )}
{role === 'Admin' && <button onClick={() => { setFormData({...p, memberPrice: p.memberPrice||p.member_price, minStock: p.minStock||p.min_stock}); setModalType('edit'); }} className="text-\[#DC2626\] hover:underline">Edit}{(role === 'Admin' || role === 'Inventory') && ( <button onClick={() => toggleArchive(p)} className="text-slate-500 hover:text-\[#DC2626\]" title={p.isArchived ? 'Aktifkan' : 'Arsipkan'}>{p.isArchived ?  : } )}

)})}



```
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

```

);
}

function Members({ members, role }: any) {
if (role !== 'Admin') return Akses Ditolak. Khusus Admin.;
const \[modal, setModal\] = useState(null);

const save = async (e:any) => {
e.preventDefault();
if (modal.id) {
await db.members.update(modal.id, modal);
await enqueueSync('UPDATE', 'members', modal);
} else {
const newM = { id: generateUUID(), ...modal, join_date: new Date().toISOString().split('T')\[0\], status: 'Aktif', points: 0, credit_balance: 0 };
await db.members.add({...newM, noInduk: newM.no_induk, joinDate: newM.join_date, creditBalance: 0});
await enqueueSync('INSERT', 'members', newM);
}
setModal(null); await logAudit('Admin', 'Update Data Anggota', modal.name);
};

return (

Manajemen Anggota<button onClick={()=>setModal({})} className="bg-slate-800 text-white px-4 py-2 rounded-xl font-bold text-sm">+ Anggota Baru

IdentitasKontakPoin TersediaSaldo PiutangStatusAksi
{members.map((m:any) => (

{m.noInduk || m.no_induk}

{m.name}
{m.phone}

{m.address}
{m.points}
{formatRp(m.creditBalance || m.credit_balance)}
<span className={`px-2 py-1 rounded text-white text-[10px] ${m.status==='Aktif'?'bg-green-600':'bg-red-600'}`}>{m.status}
<button onClick={()=>setModal({...m, no_induk: m.noInduk || m.no_induk})} className="text-\[#DC2626\] hover:underline">Edit

))}

{modal && (

Data Anggota <button onClick={()=>setModal(null)}>

<input required placeholder="No Induk Koperasi" value={modal.no_induk||''} onChange={e=>setModal({...modal,no_induk:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"/>
<input required placeholder="Nama Lengkap" value={modal.name||''} onChange={e=>setModal({...modal,name:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"/>
<input required placeholder="No HP / WhatsApp" value={modal.phone||''} onChange={e=>setModal({...modal,phone:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none"/>
<textarea placeholder="Alamat Lengkap" value={modal.address||''} onChange={e=>setModal({...modal,address:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none" rows={2}/>
{modal.id && <select value={modal.status} onChange={e=>setModal({...modal,status:e.target.value})} className="w-full p-2.5 border-2 rounded-xl bg-slate-50 outline-none">AktifNonaktif}
Simpan Anggota


)}

)
}

// PERBAIKAN: Pembersihan payload PO saat mengirim
function PurchaseOrders({ products, purchases, role, loggedInUserId }: any) {
const \[selectedProduct, setSelectedProduct\] = useState(''); const \[supplier, setSupplier\] = useState('');
const \[qty, setQty\] = useState(''); const \[price, setPrice\] = useState(''); const \[notes, setNotes\] = useState('');
const activeProducts = products.filter((p:any) => !p.isArchived);

const handleCreatePO = async (e: React.FormEvent) => {
e.preventDefault();
const p = activeProducts.find((prod: any) => prod.id === selectedProduct);
if (!p) return;
try {
const poData = {
id: generateUUID(), po_number: generatePONumber(), date: new Date().toISOString(), supplier: supplier || 'Umum',
items: \[{ productId: p.id, product_id: p.id, name: p.name, qty: Number(qty), price: Number(price), total: Number(qty) \* Number(price) }\],
total: Number(qty) \* Number(price), status: 'pending', requested_by: loggedInUserId, notes
};

```
  // Simpan properti camelCase di lokal Dexie agar tampil saat offline
  await db.purchases.add({...poData, poNumber: poData.po_number});
  await enqueueSync('INSERT', 'purchases', poData);
  await logAudit(role, 'Buat Purchase Order', `PO ${poData.po_number} untuk ${p.name}`);
  alert("Purchase Order berhasil diajukan ke Admin.");
  setSelectedProduct(''); setSupplier(''); setQty(''); setPrice(''); setNotes('');
} catch (err) { alert("Gagal membuat PO"); }

```

};

return (

{role === 'Inventory' && (

Buat Purchase Order (PO) Baru


Pilih Produk<select required value={selectedProduct} onChange={e=>setSelectedProduct(e.target.value)} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm bg-\[#F8FAFC\]">-- Pilih Barang --{activeProducts.map((p:any)=>{p.sku} - {p.name} (Stok: {p.stock}))}
Nama Supplier<input required type="text" placeholder="PT Supplier Sejahtera" value={supplier} onChange={e=>setSupplier(e.target.value)} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm bg-\[#F8FAFC\]" />


Jumlah Pesan (Qty)<input required type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-sm bg-\[#F8FAFC\]" />
Estimasi Harga Beli / Unit (Rp)<input required type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)} className="w-full p-3 border-2 border-\[#DC2626\] rounded-xl font-bold text-sm text-\[#DC2626\] bg-\[#FEE2E2\]/20" />

Catatan Pengajuan<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold text-xs bg-\[#F8FAFC\]">
Kirim PO ke Admin


)}

Daftar Purchase Order (PO)

No. POSupplierItem & QtyTotal (Rp)Status

{purchases.length === 0 ? Belum ada data PO. : purchases.map((p:any)=>(

{p.poNumber || p.po_number}{p.supplier}{p.items?.\[0\]?.name} (x{p.items?.\[0\]?.qty}){formatRp(p.total)}
<span className={`px-2.5 py-1 rounded-md text-[10px] ${p.status==='approved'?'bg-green-100 text-green-700':p.status==='rejected'?'bg-red-100 text-[#991B1B]':'bg-amber-100 text-amber-700'}`}>{p.status.toUpperCase()}

))}




);
}

// PERBAIKAN: Optional chaining di items\[0\]
function Inbound({ products, purchases, role }: any) {
if (role !== 'Inventory') return null;
const \[selectedPO, setSelectedPO\] = useState(''); const \[goodQty, setGoodQty\] = useState(''); const \[damagedQty, setDamagedQty\] = useState('');
const \[batchNumber, setBatchNumber\] = useState(''); const \[expiryDate, setExpiryDate\] = useState(''); const \[notes, setNotes\] = useState('');

const approvedPOs = purchases.filter((p: any) => p.status === 'approved');
const currentPO = approvedPOs.find((p: any) => p.id === selectedPO);

const handleInboundReceive = async (e: React.FormEvent) => {
e.preventDefault();
if (!currentPO) return;
try {
const gQty = Number(goodQty || 0); const dQty = Number(damagedQty || 0);

```
  const item = currentPO.items?.[0];
  if (!item) return alert("Gagal: Rincian barang kosong/hilang dari database cloud.");
  
  const prodId = item.productId || item.product_id;
  const prod = products.find((p: any) => p.id === prodId);
  if (!prod) return alert("Gagal: Master produk tidak ditemukan.");

  const batchNum = batchNumber || `BATCH-${Date.now().toString().slice(-6)}`;
  const expDate = expiryDate || new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')[0];

  await db.transaction('rw', [db.purchases, db.products, db.product_batches, db.audit_logs, db.sync_queue], async () => {
    await db.purchases.update(currentPO.id, { status: 'received' });
    await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'purchases', payload: { id: currentPO.id, status: 'received' }, created_at: new Date().toISOString() });
    
    if (gQty > 0) {
      const batchId = generateUUID();
      const batch = { id: batchId, product_id: prod.id, batch_number: batchNum, qty: gQty, initial_qty: gQty, hpp: Number(item.price || prod.hpp), received_date: new Date().toISOString().split('T')[0], expiry_date: expDate, condition: 'Baik' as const };
      await db.product_batches.add({ ...batch, productId: batch.product_id, batchNumber: batch.batch_number, initialQty: batch.initial_qty, receivedDate: batch.received_date, expiryDate: batch.expiry_date, createdAt: new Date().toISOString() });
      await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'product_batches', payload: batch, created_at: new Date().toISOString() });
      
      const currentBatches = await db.product_batches.where('productId').equals(prod.id).toArray();
      const totalStock = currentBatches.filter(b => b.condition === 'Baik').reduce((sum, b) => sum + b.qty, 0);
      const totalValuation = currentBatches.filter(b => b.condition === 'Baik').reduce((sum, b) => sum + (b.qty * b.hpp), 0);
      const newHPP = totalStock > 0 ? Math.round(totalValuation / totalStock) : prod.hpp;
      await db.products.update(prod.id, { stock: totalStock, hpp: newHPP });
      await db.sync_queue.add({ id: generateUUID(), operation: 'UPDATE', table_name: 'products', payload: { id: prod.id, stock: totalStock, hpp: newHPP }, created_at: new Date().toISOString() });
    }
    if (dQty > 0) {
      const dbatchId = generateUUID();
      const dbatch = { id: dbatchId, product_id: prod.id, batch_number: `${batchNum}-DMG`, qty: dQty, initial_qty: dQty, hpp: Number(item.price || prod.hpp), received_date: new Date().toISOString().split('T')[0], expiry_date: expDate, condition: 'Rusak' as const };
      await db.product_batches.add({ ...dbatch, productId: dbatch.product_id, batchNumber: dbatch.batch_number, initialQty: dbatch.initial_qty, receivedDate: dbatch.received_date, expiryDate: dbatch.expiry_date, createdAt: new Date().toISOString() });
      await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'product_batches', payload: dbatch, created_at: new Date().toISOString() });
    }
    const auditPayload = { id: generateUUID(), timestamp: new Date().toISOString(), role: 'Inventory', action: 'Penerimaan Inbound & Batch', details: `Menerima PO ${currentPO.poNumber || currentPO.po_number}: Baik (${gQty}), Rusak (${dQty})` };
    await db.audit_logs.add(auditPayload);
    await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'audit_logs', payload: auditPayload, created_at: new Date().toISOString() });
  });
  triggerPushSync();
  alert("Penerimaan barang berhasil diproses!"); setSelectedPO(''); setGoodQty(''); setDamagedQty(''); setBatchNumber(''); setExpiryDate(''); setNotes('');
} catch (err: any) { alert("Error saat memproses inbound: " + err.message); }

```

};

return (

Penerimaan Barang (Inbound & Batch)


Pilih PO yang Disetujui
<select required value={selectedPO} onChange={e=>setSelectedPO(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50">-- Pilih PO Approved --{approvedPOs.map((po:any)=>{po.poNumber || po.po_number} - {po.supplier} ({po.items?.\[0\]?.name || 'Item Tersembunyi'}, Qty: {po.items?.\[0\]?.qty || 0}))}


Jumlah Barang Baik<input required type="number" min="0" value={goodQty} onChange={e=>setGoodQty(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" />
Jumlah Barang Rusak<input type="number" min="0" value={damagedQty} onChange={e=>setDamagedQty(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" />


Nomor Batch<input required type="text" placeholder="BATCH-00X" value={batchNumber} onChange={e=>setBatchNumber(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" />
Tanggal Kedaluwarsa<input required type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)} className="w-full p-3 border-2 rounded-xl font-bold text-sm bg-slate-50" />

Simpan Inbound & Buat Batch


);
}

function StockOpnameView({ products, stockOpnames, role, loggedInUserId }: any) {
const \[opnameItems, setOpnameItems\] = useState<any\[\]>(\[\]); const \[notes, setNotes\] = useState('');
const activeProducts = products.filter((p:any) => !p.isArchived);

const startOpname = () => { setOpnameItems(activeProducts.map((p: any) => ({ productId: p.id, productName: p.name, systemStock: p.stock, physicalStock: p.stock, variance: 0, reason: '' }))); };
const handlePhysicalChange = (productId: string, val: string) => { const pStock = Number(val); setOpnameItems(opnameItems.map(item => item.productId === productId ? { ...item, physicalStock: pStock, variance: pStock - item.systemStock } : item)); };

const submitOpname = async () => {
try {
const soData: any = { id: generateUUID(), date: new Date().toISOString(), status: 'pending', items: opnameItems, requested_by: loggedInUserId, notes };
await db.stock_opnames.add(soData);
await enqueueSync('INSERT', 'stock_opnames', soData);
await logAudit(role, 'Pengajuan Stock Opname', 'Mengirim laporan opname ke Admin');
alert("Laporan diajukan ke Admin."); setOpnameItems(\[\]); setNotes('');
} catch (err) { alert("Gagal mengajukan stock opname"); }
};

return (

{role === 'Inventory' && (

Formulir Stock Opname Bulanan{opnameItems.length === 0 && Mulai Opname Baru}
{opnameItems.length > 0 && (

Nama ProdukStok SistemStok Fisik AktualSelisihAlasan Selisih
{opnameItems.map((item) => (
{item.productName}{item.systemStock}<input type="number" value={item.physicalStock} onChange={e=>handlePhysicalChange(item.productId, e.target.value)} className="w-20 p-1.5 border rounded font-bold text-center" /><span className={`px-2 py-0.5 rounded ${item.variance===0?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{item.variance}<input type="text" placeholder="Keterangan..." value={item.reason} onChange={e=>setOpnameItems(opnameItems.map(i=>i.productId===item.productId?{...i,reason:e.target.value}:i))} className="w-full p-1.5 border rounded" />
))}
Catatan Kesimpulan<input type="text" value={notes} onChange={e=>setNotes(e.target.value)} className="w-full p-3 border-2 rounded-xl" />
Ajukan Berita Acara ke Admin

)}

)}
Riwayat Stock Opname
TanggalCatatanStatus Berita Acara
{stockOpnames.map((so:any)=>({formatDate(so.date, true)}{so.notes || '-'}<span className={`px-2.5 py-1 rounded-md text-[10px] ${so.status==='approved'?'bg-green-100 text-green-700':so.status==='rejected'?'bg-red-100 text-[#991B1B]':'bg-amber-100 text-amber-700'}`}>{so.status.toUpperCase()}))}


);
}

function HistoryView({ sales, purchases, role }: any) {
const \[filter, setFilter\] = useState('sales');
const requestCancel = async (id: string, receiptNo: string) => {
if(window.confirm(`Ajukan pembatalan transaksi ${receiptNo}?`)) {
await db.sales.update(id, { status: 'cancel_requested' });
await enqueueSync('UPDATE', 'sales', { id, status: 'cancel_requested' });
await logAudit(role, 'Pengajuan Batal', `Mengajukan pembatalan transaksi ${receiptNo}`);
alert("Pengajuan pembatalan berhasil dikirim.");
}
};
return (


<button onClick={() => setFilter('sales')} className={`px-4 py-2 rounded-lg font-black text-xs ${filter === 'sales' ? 'bg-[#DC2626] text-white shadow-sm' : 'bg-white text-slate-500 border'}`}>Riwayat Penjualan (Kasir)
{(role === 'Inventory' || role === 'Admin') && <button onClick={() => setFilter('purchases')} className={`px-4 py-2 rounded-lg font-black text-xs ${filter === 'purchases' ? 'bg-[#DC2626] text-white shadow-sm' : 'bg-white text-slate-500 border'}`}>Riwayat PO & Inbound}


WaktuReferensiTotal (Rp)Status{filter === 'sales' && role === 'Kasir' && Aksi}

{(filter === 'sales' ? sales : purchases).map((item: any) => (

{formatDate(item.date, true)}
{item.receiptNumber || item.receipt_number || item.poNumber || item.po_number}
{formatRp(item.total)}

{item.status === 'completed' || item.status === 'approved' || item.status === 'received' ? Berhasil :
item.status === 'cancelled' || item.status === 'rejected' ? Dibatalkan/Ditolak :
item.status === 'cancel_requested' ? Menunggu Batal :
Pending}

{filter === 'sales' && role === 'Kasir' && {item.status === 'completed' && <button onClick={()=>requestCancel(item.id, item.receiptNumber || item.receipt_number)} className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-\[10px\] font-black shadow-sm">Batalkan}}

))}



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
await db.transaction('rw', \[db.sales, db.purchases, db.stock_opnames, db.shifts, db.products, db.product_batches, db.audit_logs, db.sync_queue\], async () => {
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
received_date: new Date().toISOString().split('T')\[0\],
expiry_date: new Date(Date.now() + 365*24*60*60*1000).toISOString().split('T')\[0\],
condition: 'Baik' as const
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

```
    const logId = generateUUID();
    const auditPayload = { id: logId, timestamp: new Date().toISOString(), role: 'Admin', action: `Approval ${type}`, details: `Aksi: ${accept ? 'Disetujui' : 'Ditolak'}` };
    await db.audit_logs.add(auditPayload);
    await db.sync_queue.add({ id: generateUUID(), operation: 'INSERT', table_name: 'audit_logs', payload: auditPayload, created_at: new Date().toISOString() });
  });
  triggerPushSync();
  alert('Tindakan berhasil disimpan!');
} catch(err) { alert('Gagal memproses approval.'); }

```

};

const CardList = ({ title, data, type, renderItem }: any) => (

{title} {data.length}
{data.length===0 ? Tidak ada data pending. : data.map((d:any) => (

{renderItem(d)}

<button onClick={()=>approve(type, d, false)} className="px-4 py-2 bg-slate-50 border text-slate-800 rounded-lg font-black text-xs transition">Tolak / Klarifikasi
<button onClick={()=>approve(type, d, true)} className="px-4 py-2 bg-\[#DC2626\] text-white rounded-lg font-black text-xs shadow-md transition">Setujui & Valid


))}

);

// PERBAIKAN: Optional chaining (.?) digunakan pada items untuk mencegah crash jika array kosong
return (

<CardList title="Verifikasi Setoran Uang Tutup Shift" data={pendingShifts} type="shift" renderItem={(d:any) => Shift: {d.shiftNumber} ({d.cashierName}) 

Uang Seharusnya: {formatRp(d.expectedCash || d.expected_cash)} | Uang Disetor: {formatRp(d.physicalCash || d.physical_cash)} 

 Selisih: {formatRp(d.variance)}} />
<CardList title="Pengajuan Batal Transaksi (Kasir)" data={pendingCancels} type="cancel" renderItem={(d:any) => TRX: {d.receiptNumber || d.receipt_number} {formatRp(d.total)}{formatDate(d.date, true)}} />
<CardList title="Pengajuan Purchase Order (PO) Gudang" data={pendingPO} type="po" renderItem={(d:any) => PO: {d.poNumber || d.po_number} (Supplier: {d.supplier}){d.items?.\[0\]?.name || 'Item tidak ditemukan'} (Qty: {d.items?.\[0\]?.qty || 0}) - Total: {formatRp(d.total)}} />
<CardList title="Pengajuan Berita Acara Stock Opname" data={pendingOpname} type="opname" renderItem={(d:any) => Opname Tanggal: {formatDate(d.date, true)}Total Item Diperiksa: {d.items?.length || 0} item} />

);
}

function Expenses({ expenses, role, loggedInUserId }: any) {
if (role !== 'Admin') return null;
const \[desc, setDesc\] = useState(''); const \[amount, setAmount\] = useState('');
const save = async (e: React.FormEvent) => {
e.preventDefault();
const ex = {id:generateUUID(), date:new Date().toISOString(), description:desc, amount:Number(amount), created_by: loggedInUserId};
await db.expenses.add(ex);
await enqueueSync('INSERT', 'expenses', ex);
await logAudit('Admin', 'Biaya Operasional', `Mencatat biaya: ${desc}`);
setDesc(''); setAmount('');
};
return (


Catat Biaya Baru

Keperluan / Deskripsi<input required type="text" placeholder="Misal: Beli Plastik, Listrik..." value={desc} onChange={e=>setDesc(e.target.value)} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold bg-\[#F8FAFC\] outline-none" />
Jumlah Biaya (Rp)<input required type="number" placeholder="Nominal" value={amount} onChange={e=>setAmount(e.target.value)} className="w-full p-3 border-2 border-\[#E2E8F0\] rounded-xl font-bold bg-\[#F8FAFC\] outline-none" />
Simpan Pengeluaran



Riwayat Biaya
{expenses.map((ex:any) => ({ex.description}{formatDate(ex.date, true)}{formatRp(ex.amount)}))}


)
}

function AuditTrail({ logs, role }: any) {
if (role !== 'Admin') return null;
return (

 Riwayat Aktivitas Sistem

Waktu TerjadiPeranAktivitas / Detail
{logs.map((l:any) => ({new Date(l.timestamp).toLocaleString('id-ID')}{l.role}{l.action}: {l.details}))}


)
}

function Reports({ products, sales, expenses, role }: any) {
if (role !== 'Admin') return null;
const handleExportDetailed = async () => {
const completedSales = sales.filter((s: any) => s.status === 'completed');
const productSalesMap: { \[key: string\]: { name: string; qty: number; revenue: number; profit: number } } = {};
completedSales.forEach((sale: any) => {
sale.items?.forEach((item: any) => {
const pId = item.productId || item.product_id;
if (!productSalesMap\[pId\]) productSalesMap\[pId\] = { name: item.name, qty: 0, revenue: 0, profit: 0 };
productSalesMap\[pId\].qty += item.qty; productSalesMap\[pId\].revenue += item.subtotal;
productSalesMap\[pId\].profit += (item.subtotal - ((item.hpp || 0) \* item.qty));
});
});
const productSalesList = Object.values(productSalesMap);
const wb = XLSX.utils.book_new();

```
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

```

};

return (

Laporan Keuangan & Operasional Lengkap
File Excel yang dihasilkan mencakup multi-tab: 

Ringkasan Laba Rugi, Rincian Barang Terjual, Daftar Transaksi, hingga Biaya Operasional.
 Unduh Laporan Excel Komprehensif (.xlsx)

);
}

function SettingsView({ role, appLogoUrl }: any) {
if (role !== 'Admin') return null;
const handleLogoUpload = async (e: any) => {
const file = e.target.files\[0\];
if (file) {
if (file.size > 1024 \* 1024) return alert("Ukuran logo maksimal 1MB.");
const reader = new FileReader();
reader.onload = async (ev) => {
await db.settings.put({ id: 'appLogo', value: ev.target?.result as string });
alert("Logo berhasil diperbarui!");
};
reader.readAsDataURL(file);
}
};

return (


 Pengaturan Identitas Aplikasi
Ubah logo Koperasi yang akan ditampilkan di aplikasi dan dokumen cetak.


{appLogoUrl ?  : Belum ada logo}


Pilih File Logo...
\*Format: PNG, JPG (Maks. 1MB)




 Arsitektur Sinkronisasi Aktif
Saat ini, Anda tidak perlu melakukan Backup & Restore manual ke JSON karena aplikasi secara otomatis mencadangkan datanya melalui Supabase Cloud Sync secara Background (Latar Belakang).


)
}
