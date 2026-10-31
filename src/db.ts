import Dexie, { Table } from 'dexie';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  hpp: number;
  price: number;
  stock: number;
  minStock: number;
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
  condition: 'Baik' | 'Rusak';
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  date: string;
  supplier: string;
  items: { productId: string; name: string; qty: number; price: number; total: number }[];
  total: number;
  status: 'pending' | 'approved' | 'rejected' | 'received';
  requestedBy: string;
  notes?: string;
}

export interface StockOpnameItem {
  productId: string;
  productName: string;
  systemStock: number;
  physicalStock: number;
  variance: number;
  reason?: string;
}

export interface StockOpname {
  id: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  items: StockOpnameItem[];
  requestedBy: string;
  notes?: string;
}

export class MySubClassedDexie extends Dexie {
  products!: Table<Product>;
  product_batches!: Table<ProductBatch>;
  purchases!: Table<any>;
  sales!: Table<any>;
  expenses!: Table<any>;
  adjustments!: Table<any>;
  stock_opnames!: Table<StockOpname>;
  cash_registers!: Table<any>;
  audit_logs!: Table<any>;
  settings!: Table<any>;

  constructor() {
    super('POSLocalDB');
    this.version(2).stores({
      products: 'id, sku, name, category, stock, minStock',
      product_batches: 'id, productId, batchNumber, expiryDate, condition',
      purchases: 'id, poNumber, date, status, supplier',
      sales: 'id, receiptNumber, date, status',
      expenses: 'id, date',
      adjustments: 'id, date, status',
      stock_opnames: 'id, date, status',
      cash_registers: 'id, date, status',
      audit_logs: 'id, timestamp, role',
      settings: 'id'
    });
  }
}

export const db = new MySubClassedDexie();