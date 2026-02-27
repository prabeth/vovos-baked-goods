import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

// Tipagem para os pedidos
interface Order {
  id: string;
  customerName: string;
  items: any[];
  total: number;
  status: 'pending' | 'completed';
  createdAt: string;
}

// Handler para processar requisições (Vercel Serverless)
export default async function handler(req: any, res: any) {
  const { method } = req;

  try {
    if (method === 'GET') {
      // Busca todos os pedidos no KV da Vercel
      const keys = await kv.keys('order:*');
      if (keys.length === 0) return res.status(200).json([]);
      
      const orders = await kv.mget(...keys);
      return res.status(200).json(orders.sort((a: any, b: any) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    }

    if (method === 'POST') {
      const orderData = req.body;
      const newOrder: Order = {
        id: uuidv4(),
        ...orderData,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // Salva no banco de dados KV da Vercel
      await kv.set(`order:${newOrder.id}`, newOrder);
      return res.status(201).json(newOrder);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${method} Not Allowed`);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao processar pedido' });
  }
}import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const dbPath = path.join(__dirname, "orders.db");
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
console.log(`Database initialized at ${dbPath}`);

// Initialize database
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_phone TEXT,
      order_date TEXT,
      order_time TEXT,
      items TEXT,
      total REAL,
      payment_method TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      description TEXT,
      image TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  console.log("Database tables verified/created");
} catch (err) {
  console.error("Database initialization failed:", err);
}

// Seed default products if empty
const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
if (productCount.count === 0) {
  const seedProducts = [
    { name: 'Bolo de Cenoura', price: 25.00, description: 'Bolo fofinho com cobertura generosa de chocolate belga.', image: 'https://picsum.photos/seed/carrot/200/200' },
    { name: 'Torta de Limão', price: 30.00, description: 'Massa crocante com creme de limão siciliano e merengue.', image: 'https://picsum.photos/seed/lemon/200/200' },
    { name: 'Brownie Caseiro (6 un)', price: 18.00, description: 'Brownies intensos de chocolate meio amargo com nozes.', image: 'https://picsum.photos/seed/brownie/200/200' },
    { name: 'Pão de Mel', price: 5.50, description: 'Recheado com doce de leite artesanal e banhado em chocolate.', image: 'https://picsum.photos/seed/honey/200/200' },
    { name: 'Cookie Chocolate', price: 7.00, description: 'Cookie americano clássico com gotas de chocolate 50%.', image: 'https://picsum.photos/seed/cookie/200/200' },
    { name: 'Cupcake Baunilha', price: 12.00, description: 'Massa leve de baunilha com frosting cremoso.', image: 'https://picsum.photos/seed/cupcake/200/200' },
    { name: 'Bolo de Fubá', price: 20.00, description: 'Receita tradicional da vovó, perfeito para o café.', image: 'https://picsum.photos/seed/corn/200/200' },
    { name: 'Quiche de Alho Poró', price: 35.00, description: 'Massa brisée amanteigada com recheio cremoso de alho poró.', image: 'https://picsum.photos/seed/quiche/200/200' },
  ];
  const insert = db.prepare("INSERT INTO products (name, price, description, image) VALUES (?, ?, ?, ?)");
  seedProducts.forEach(p => insert.run(p.name, p.price, p.description, p.image));
}

// Seed default settings if empty
const settingsCount = db.prepare("SELECT COUNT(*) as count FROM settings").get() as { count: number };
if (settingsCount.count === 0) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('site_name', "vovosbaked");
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('capacity_limit', '10');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('admin_password', 'admin123');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('logo_url', 'https://picsum.photos/seed/vovo/200/200');
}

// Migration: Ensure columns exist
try {
  const orderTableInfo = db.prepare("PRAGMA table_info(orders)").all() as any[];
  const orderColumns = orderTableInfo.map(col => col.name);
  if (!orderColumns.includes('customer_phone')) db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT");
  if (!orderColumns.includes('order_time')) db.exec("ALTER TABLE orders ADD COLUMN order_time TEXT");
  if (!orderColumns.includes('payment_method')) db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT");

  const productTableInfo = db.prepare("PRAGMA table_info(products)").all() as any[];
  const productColumns = productTableInfo.map(col => col.name);
  if (!productColumns.includes('active')) {
    db.exec("ALTER TABLE products ADD COLUMN active INTEGER DEFAULT 1");
    db.exec("UPDATE products SET active = 1 WHERE active IS NULL");
  }
} catch (err) {
  console.error("Migration failed:", err);
}

const getSetting = (key: string, defaultValue: string) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string };
  return row ? row.value : defaultValue;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  });
  const upload = multer({ storage });

  // Serve uploads directory
  app.use("/uploads", express.static(uploadsDir));

  // API: Upload File
  app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const filePath = `/uploads/${req.file.filename}`;
    res.json({ url: filePath });
  });

  // API: Get Settings
  app.get("/api/settings", (req, res) => {
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string, value: string }[];
    const settings = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
    res.json(settings);
  });

  // API: Update Setting
  app.post("/api/settings", (req, res) => {
    const { key, value } = req.body;
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(value));
    res.json({ success: true });
  });

  // API: Get Products
  app.get("/api/products", (req, res) => {
    const products = db.prepare("SELECT * FROM products WHERE active = 1").all();
    res.json(products);
  });

  // API: Manage Products (Add/Update)
  app.post("/api/products", (req, res) => {
    try {
      const { id, name, price, description, image } = req.body;
      console.log("Product POST received:", { id, name, price });
      
      if (id) {
        const result = db.prepare("UPDATE products SET name = ?, price = ?, description = ?, image = ? WHERE id = ?")
          .run(name, price, description, image, id);
        console.log("Update result:", result);
      } else {
        const result = db.prepare("INSERT INTO products (name, price, description, image) VALUES (?, ?, ?, ?)")
          .run(name, price, description, image);
        console.log("Insert result:", result);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error managing product:", error);
      res.status(500).json({ error: "Failed to save product" });
    }
  });

  // API: Delete Product (Deactivate)
  app.delete("/api/products/:id", (req, res) => {
    try {
      console.log(`Deactivating product ID: ${req.params.id}`);
      const result = db.prepare("UPDATE products SET active = 0 WHERE id = ?").run(req.params.id);
      console.log(`Product deactivated. Rows affected: ${result.changes}`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deactivating product:", error);
      res.status(500).json({ error: "Erro ao excluir produto" });
    }
  });

  // API: Get availability for a specific month/range
  app.get("/api/availability", (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "Start and end dates required" });
    }

    const capacityLimit = parseInt(getSetting('capacity_limit', '10'));

    const stmt = db.prepare(`
      SELECT order_date, COUNT(*) as count 
      FROM orders 
      WHERE order_date BETWEEN ? AND ?
      GROUP BY order_date
    `);
    
    const rows = stmt.all(start, end) as { order_date: string; count: number }[];
    const availability = rows.reduce((acc, row) => {
      acc[row.order_date] = row.count >= capacityLimit ? "sold_out" : "available";
      return acc;
    }, {} as Record<string, string>);

    res.json(availability);
  });

  // API: Check specific date availability
  app.get("/api/check-date", (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "Date required" });

    const capacityLimit = parseInt(getSetting('capacity_limit', '10'));

    const stmt = db.prepare("SELECT COUNT(*) as count FROM orders WHERE order_date = ?");
    const row = stmt.get(date) as { count: number };
    
    res.json({
      date,
      count: row.count,
      available: row.count < capacityLimit,
      remaining: capacityLimit - row.count
    });
  });

  // API: Create order
  app.post("/api/orders", (req, res) => {
    try {
      console.log("Order request body:", req.body);
      const { customer_name, customer_phone, order_date, order_time, items, total, payment_method } = req.body;
      
      if (!customer_name || !customer_phone || !order_date || !order_time || !items) {
        console.error("Missing required fields:", { customer_name, customer_phone, order_date, order_time, items });
        return res.status(400).json({ error: "Campos obrigatórios ausentes" });
      }

      console.log("Creating order for:", { customer_name, order_date, order_time });

      const capacityLimit = parseInt(getSetting('capacity_limit', '10'));

      // Check capacity again before saving
      const checkStmt = db.prepare("SELECT COUNT(*) as count FROM orders WHERE order_date = ?");
      const checkRow = checkStmt.get(order_date) as { count: number };

      if (checkRow && checkRow.count >= capacityLimit) {
        console.warn("Capacity limit reached for date:", order_date);
        return res.status(400).json({ error: "Data esgotada" });
      }

      const stmt = db.prepare(`
        INSERT INTO orders (customer_name, customer_phone, order_date, order_time, items, total, payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(customer_name, customer_phone, order_date, order_time, items, total, payment_method);
      console.log("Order created successfully, ID:", result.lastInsertRowid);
      
      // Notification Simulation
      console.log("--- NOTIFICAÇÃO DE NOVO PEDIDO ---");
      console.log(`Cliente: ${customer_name}`);
      console.log(`Telefone: ${customer_phone}`);
      console.log(`Data: ${order_date} às ${order_time}`);
      console.log(`Pagamento: ${payment_method}`);
      console.log(`Total: $${total}`);
      console.log("----------------------------------");

      res.json({ id: result.lastInsertRowid });
    } catch (error) {
      console.error("Error creating order:", error);
      res.status(500).json({ error: "Erro interno ao salvar pedido" });
    }
  });

  // API: Get all orders (for admin)
  app.get("/api/admin/orders", (req, res) => {
    try {
      const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
      console.log(`Fetched ${orders.length} orders for admin`);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching admin orders:", error);
      res.status(500).json({ error: "Erro ao buscar pedidos" });
    }
  });

  // API: Delete Order
  app.delete("/api/admin/orders/:id", (req, res) => {
    db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // API: Update Order
  app.post("/api/admin/orders/update", (req, res) => {
    const { id, customer_name, customer_phone, order_date, order_time, items, total, payment_method } = req.body;
    db.prepare(`
      UPDATE orders 
      SET customer_name = ?, customer_phone = ?, order_date = ?, order_time = ?, items = ?, total = ?, payment_method = ?
      WHERE id = ?
    `).run(customer_name, customer_phone, order_date, order_time, items, total, payment_method, id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
