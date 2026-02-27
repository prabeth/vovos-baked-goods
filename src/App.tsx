import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { Calendar as CalendarIcon, ShoppingBag, CheckCircle2, AlertCircle, MessageSquare, Settings, Package, List, Plus, Trash2, X, Save, LogIn } from 'lucide-react';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { format, addDays, isSunday, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Availability {
  [key: string]: 'available' | 'sold_out';
}

interface Product {
  id: string;
  name: string;
  price: number;
  description?: string;
  image?: string;
}

interface Order {
  id: number;
  customer_name: string;
  customer_phone: string;
  order_date: string;
  order_time: string;
  items: string;
  total: number;
  payment_method: string;
  created_at: string;
}

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', 
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', 
  '16:00', '16:30', '17:00', '17:30', '18:00'
];

export default function App() {
  const [page, setPage] = useState<'schedule' | 'order' | 'success' | 'admin'>('schedule');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [availability, setAvailability] = useState<Availability>({});
  const [fetchingAvailability, setFetchingAvailability] = useState(true);
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({
    site_name: "vovosbaked",
    capacity_limit: '10'
  });
  const [adminTab, setAdminTab] = useState<'orders' | 'products' | 'settings'>('orders');
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editingItems, setEditingItems] = useState<Record<string, number>>({});

  const startEditingOrder = (order: Order) => {
    setEditingOrder(order);
    const itemsMap: Record<string, number> = {};
    // Parse items string: "2x Bolo\n1x Quiche" or "2x Bolo, 1x Quiche"
    const parts = order.items.split(/, |\n/).filter(Boolean);
    parts.forEach(p => {
      const match = p.match(/^(\d+)x\s+(.+)$/);
      if (match) {
        const qty = parseInt(match[1]);
        const productName = match[2].trim();
        const product = products.find(prod => prod.name === productName);
        if (product) {
          itemsMap[product.id] = qty;
        }
      }
    });
    setEditingItems(itemsMap);
  };

  const updateEditingOrderItems = (newItems: Record<string, number>) => {
    if (!editingOrder) return;
    
    const summary = Object.entries(newItems)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => {
        const p = products.find(prod => String(prod.id) === String(id));
        return `${qty}x ${p?.name}`;
      }).join('\n');

    const newTotal = Object.entries(newItems).reduce((acc, [id, qty]) => {
      const p = products.find(prod => String(prod.id) === String(id));
      return acc + (p ? p.price * qty : 0);
    }, 0);

    setEditingOrder({
      ...editingOrder,
      items: summary,
      total: newTotal
    });
  };
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', description: '', image: '' });

  const [orderData, setOrderData] = useState({
    name: '',
    phone: '',
    selectedItems: {} as Record<string, number>,
    paymentMethod: 'zelle' as 'zelle' | 'cash',
    time: '',
  });

  // Calculate total automatically
  const total = Object.entries(orderData.selectedItems).reduce((acc: number, [id, qty]: [string, number]) => {
    const product = products.find(p => String(p.id) === String(id));
    const price = product ? product.price : 0;
    return acc + (price * qty);
  }, 0);

 const fetchProducts = async () => {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    
    // AJUSTE PARA POSTGRES:
    // Se 'data' for um array, usa direto. Se for um objeto com 'rows', usa o rows.
    const productsList = Array.isArray(data) ? data : (data.rows || []);
    setProducts(productsList);
  } catch (err) {
    console.error("Failed to fetch products", err);
    setProducts([]); // Evita que o app trave se der erro
  }
};

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const fetchAdminOrders = async () => {
    try {
      const res = await fetch('/api/admin/orders');
      const data = await res.json();
      setAdminOrders(data);
    } catch (err) {
      console.error("Failed to fetch admin orders", err);
    }
  };

  const handleLogout = () => {
    setIsAdminAuthenticated(false);
    setAdminPassword('');
    setPage('schedule');
  };

  const handleFileUpload = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      return data.url;
    } catch (err) {
      console.error("Upload failed", err);
      alert("Falha ao carregar imagem");
      return '';
    }
  };

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      await Promise.all([fetchProducts(), fetchSettings()]);

      // Sync URL with state for "query string" requirement
      const params = new URLSearchParams(window.location.search);
      const dateParam = params.get('data');
      const timeParam = params.get('hora');
      if (dateParam) {
        const date = new Date(`${dateParam}T12:00:00`);
        if (!isNaN(date.getTime()) && !isSunday(date)) {
          setSelectedDate(date);
          if (timeParam && TIME_SLOTS.includes(timeParam)) {
            setOrderData(prev => ({ ...prev, time: timeParam }));
            setPage('order');
          }
        }
      }
    };
    fetchData();
  }, []);

  // Fetch availability when month changes or on mount
  useEffect(() => {
    const fetchAvailability = async () => {
      setFetchingAvailability(true);
      const start = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      const end = format(endOfMonth(addDays(new Date(), 60)), 'yyyy-MM-dd');
      try {
        const res = await fetch(`/api/availability?start=${start}&end=${end}`);
        const data = await res.json();
        setAvailability(data);
      } catch (err) {
        console.error("Failed to fetch availability", err);
      } finally {
        setFetchingAvailability(false);
      }
    };
    fetchAvailability();
  }, []);

  const handleDateSelect = (date: Date | null) => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    if (availability[dateStr] === 'sold_out') return;
    setSelectedDate(date);
  };

  const proceedToOrder = () => {
    if (selectedDate && orderData.time) {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      window.history.pushState({}, '', `?data=${dateStr}&hora=${orderData.time}`);
      setPage('order');
    } else if (selectedDate && !orderData.time) {
      alert("Por favor, selecione um horário.");
    }
  };

  const updateItemQuantity = (id: string, delta: number) => {
    setOrderData(prev => {
      const newQty = (prev.selectedItems[id] || 0) + delta;
      const newItems = { ...prev.selectedItems };
      if (newQty <= 0) {
        delete newItems[id];
      } else {
        newItems[id] = newQty;
      }
      return { ...prev, selectedItems: newItems };
    });
  };

  const formatPhoneNumber = (value: string) => {
    if (!value) return value;
    const phoneNumber = value.replace(/[^\d]/g, '');
    const phoneNumberLength = phoneNumber.length;
    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    }
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formattedPhoneNumber = formatPhoneNumber(e.target.value);
    setOrderData({ ...orderData, phone: formattedPhoneNumber });
    setPhoneError('');
  };

  const validatePhone = (phone: string) => {
    const phoneRegex = /^\(\d{3}\) \d{3}-\d{4}$/;
    return phoneRegex.test(phone);
  };

  const submitOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDate || total === 0) return;

    if (!validatePhone(orderData.phone)) {
      setPhoneError('Por favor, insira um telefone válido no formato (XXX) XXX-XXXX');
      return;
    }

    const itemsSummary = Object.entries(orderData.selectedItems).map(([id, qty]) => {
      const p = products.find(prod => String(prod.id) === String(id));
      return `${qty}x ${p?.name}`;
    }).join('\n');

    console.log("Submitting order with data:", {
      customer_name: orderData.name,
      customer_phone: orderData.phone,
      order_date: format(selectedDate, 'yyyy-MM-dd'),
      order_time: orderData.time,
      items: itemsSummary,
      total: total,
      payment_method: orderData.paymentMethod
    });

    setLoading(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: orderData.name,
          customer_phone: orderData.phone,
          order_date: format(selectedDate, 'yyyy-MM-dd'),
          order_time: orderData.time,
          items: itemsSummary,
          total: total,
          payment_method: orderData.paymentMethod
        })
      });

      console.log("Order response status:", res.status);
      if (res.ok) {
        console.log("Order saved successfully");
        setPage('success');
      } else {
        const err = await res.json();
        console.error("Order save failed:", err);
        alert(err.error || "Erro ao processar pedido");
      }
    } catch (err) {
      console.error("Order submission error:", err);
      alert("Erro de conexão");
    } finally {
      setLoading(false);
    }
  };

  const sendWhatsApp = () => {
    const dateStr = selectedDate ? format(selectedDate, 'dd/MM/yyyy') : '';
    const itemsSummary = Object.entries(orderData.selectedItems).map(([id, qty]) => {
      const p = products.find(prod => String(prod.id) === String(id));
      return `${qty}x ${p?.name}`;
    }).join('\n');

    const paymentText = orderData.paymentMethod === 'zelle' 
      ? `Via Zelle. Our Zelle: 7708757348.` 
      : `Cash (Pagamento na entrega/retirada).`;

    const message = `Olá! Gostaria de confirmar meu pedido:
*Cliente:* ${orderData.name}
*Telefone:* ${orderData.phone}
*Data:* ${dateStr}
*Horário:* ${orderData.time}
*Itens:*
${itemsSummary}

*Total:* $${total.toFixed(2)}

*Pagamento:* ${paymentText}
_Pedido sujeito à confirmação._`;
    
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/17708757348?text=${encoded}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#f5f2ed] text-[#1a1a1a] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center text-white overflow-hidden border-2 border-white shadow-sm">
              <img 
                src={settings.logo_url || "https://picsum.photos/seed/vovo/200/200"} 
                alt="Logo"
                className="w-full h-full object-contain bg-white"
                referrerPolicy="no-referrer"
              />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{settings.site_name}</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setAdminPassword('');
                setPage(page === 'admin' ? 'schedule' : 'admin');
              }}
              className="p-2 text-black/20 hover:text-emerald-600 transition-colors"
              title="Admin"
            >
              <Settings size={18} />
            </button>
            <div className="text-xs uppercase tracking-widest font-semibold text-black/40">
              {page === 'schedule' ? 'Agenda' : page === 'order' ? 'Pedido' : page === 'admin' ? 'Painel Admin' : 'Concluído'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {page === 'admin' && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              {!isAdminAuthenticated ? (
                <div className="max-w-md mx-auto bg-white p-8 rounded-3xl shadow-sm border border-black/5 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <LogIn size={32} />
                    </div>
                    <h2 className="text-2xl font-serif">Acesso Restrito</h2>
                    <p className="text-sm text-black/40">Digite a senha para gerenciar o sistema.</p>
                  </div>
                  <div className="space-y-4">
                    <input 
                      type="password" 
                      value={adminPassword}
                      onChange={e => setAdminPassword(e.target.value)}
                      placeholder="Digite sua senha"
                      className="w-full p-4 bg-[#fcfbf9] border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                    <button 
                      onClick={() => {
                        if (adminPassword === (settings.admin_password || 'admin123')) {
                          setIsAdminAuthenticated(true);
                          fetchAdminOrders();
                        } else {
                          alert("Senha incorreta");
                        }
                      }}
                      className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-semibold"
                    >
                      Entrar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-wrap gap-4 border-b border-black/5 pb-4 items-center justify-between">
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setAdminTab('orders')}
                        className={cn("px-4 py-2 rounded-xl text-sm font-semibold transition-all", adminTab === 'orders' ? "bg-emerald-600 text-white" : "bg-white text-black/40")}
                      >
                        Pedidos
                      </button>
                      <button 
                        onClick={() => setAdminTab('products')}
                        className={cn("px-4 py-2 rounded-xl text-sm font-semibold transition-all", adminTab === 'products' ? "bg-emerald-600 text-white" : "bg-white text-black/40")}
                      >
                        Produtos
                      </button>
                      <button 
                        onClick={() => setAdminTab('settings')}
                        className={cn("px-4 py-2 rounded-xl text-sm font-semibold transition-all", adminTab === 'settings' ? "bg-emerald-600 text-white" : "bg-white text-black/40")}
                      >
                        Configurações
                      </button>
                    </div>
                    <button 
                      onClick={handleLogout}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-all flex items-center gap-2"
                    >
                      <X size={16} /> Sair
                    </button>
                  </div>

                  {adminTab === 'orders' && (
                    <div className="space-y-6">
                      {editingOrder && (
                        <div className="bg-amber-50 p-6 rounded-3xl border border-amber-200 space-y-4">
                          <div className="flex justify-between items-center">
                            <h3 className="font-semibold">Editando Pedido #{editingOrder.id}</h3>
                            <button onClick={() => setEditingOrder(null)}><X size={18}/></button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input 
                              value={editingOrder.customer_name} 
                              onChange={e => setEditingOrder({...editingOrder, customer_name: e.target.value})}
                              placeholder="Nome" className="p-3 bg-white border border-black/5 rounded-xl text-sm" 
                            />
                            <input 
                              value={editingOrder.customer_phone} 
                              onChange={e => setEditingOrder({...editingOrder, customer_phone: e.target.value})}
                              placeholder="Telefone" className="p-3 bg-white border border-black/5 rounded-xl text-sm" 
                            />
                            <input 
                              type="date"
                              value={editingOrder.order_date} 
                              onChange={e => setEditingOrder({...editingOrder, order_date: e.target.value})}
                              className="p-3 bg-white border border-black/5 rounded-xl text-sm" 
                            />
                            <select 
                              value={editingOrder.order_time}
                              onChange={e => setEditingOrder({...editingOrder, order_time: e.target.value})}
                              className="p-3 bg-white border border-black/5 rounded-xl text-sm"
                            >
                              {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <div className="md:col-span-2 space-y-2">
                              <label className="text-xs font-bold uppercase text-black/40">Itens do Pedido (Seleção)</label>
                              <div className="max-h-48 overflow-y-auto border border-black/5 rounded-xl bg-white p-2 space-y-1 scrollbar-thin scrollbar-thumb-gray-200">
                                {products.map(p => {
                                  const qty = editingItems[p.id] || 0;
                                  return (
                                    <div key={p.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors">
                                      <div className="flex flex-col">
                                        <span className="text-sm font-medium">{p.name}</span>
                                        <span className="text-[10px] text-black/40">${p.price.toFixed(2)}</span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <button 
                                          type="button"
                                          onClick={() => {
                                            const newQty = Math.max(0, qty - 1);
                                            const newItems = { ...editingItems, [p.id]: newQty };
                                            if (newQty === 0) delete newItems[p.id];
                                            setEditingItems(newItems);
                                            updateEditingOrderItems(newItems);
                                          }}
                                          className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors"
                                        >-</button>
                                        <span className="text-sm font-bold w-4 text-center">{qty}</span>
                                        <button 
                                          type="button"
                                          onClick={() => {
                                            const newItems = { ...editingItems, [p.id]: qty + 1 };
                                            setEditingItems(newItems);
                                            updateEditingOrderItems(newItems);
                                          }}
                                          className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                                        >+</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="text-[10px] text-black/40 italic">O total é recalculado automaticamente ao alterar os itens.</p>
                            </div>
                            <div className="flex gap-4 items-center md:col-span-2">
                              <div className="flex-1 space-y-1">
                                <label className="text-[10px] font-bold uppercase text-black/40">Total ($)</label>
                                <input 
                                  type="number"
                                  value={editingOrder.total} 
                                  onChange={e => setEditingOrder({...editingOrder, total: parseFloat(e.target.value) || 0})}
                                  className="w-full p-3 bg-white border border-black/5 rounded-xl text-sm" 
                                />
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-[10px] font-bold uppercase text-black/40">Pagamento</label>
                                <select 
                                  value={editingOrder.payment_method}
                                  onChange={e => setEditingOrder({...editingOrder, payment_method: e.target.value as any})}
                                  className="w-full p-3 bg-white border border-black/5 rounded-xl text-sm"
                                >
                                  <option value="zelle">Zelle</option>
                                  <option value="cash">Dinheiro</option>
                                </select>
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={async () => {
                              await fetch('/api/admin/orders/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(editingOrder)
                              });
                              setEditingOrder(null);
                              fetchAdminOrders();
                            }}
                            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold"
                          >
                            Salvar Alterações
                          </button>
                        </div>
                      )}

                      <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-[#fcfbf9] border-b border-black/5">
                              <tr>
                                <th className="p-4 font-semibold text-black/40 uppercase tracking-wider">Ações</th>
                                <th className="p-4 font-semibold text-black/40 uppercase tracking-wider">Data/Hora</th>
                                <th className="p-4 font-semibold text-black/40 uppercase tracking-wider">Cliente</th>
                                <th className="p-4 font-semibold text-black/40 uppercase tracking-wider">Itens</th>
                                <th className="p-4 font-semibold text-black/40 uppercase tracking-wider">Total</th>
                                <th className="p-4 font-semibold text-black/40 uppercase tracking-wider">Pagamento</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5">
                              {adminOrders.map(order => (
                                <tr key={order.id} className="hover:bg-emerald-50/30 transition-colors">
                                  <td className="p-4">
                                    <div className="flex gap-2">
                                      <button 
                                        onClick={() => setEditingOrder(order)}
                                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                                      >
                                        <Settings size={16} />
                                      </button>
                                      <button 
                                        onClick={async () => {
                                          if (confirm("Excluir este pedido permanentemente?")) {
                                            await fetch(`/api/admin/orders/${order.id}`, { method: 'DELETE' });
                                            fetchAdminOrders();
                                          }
                                        }}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-4">
                                    <div className="font-medium">{format(new Date(order.order_date + 'T12:00:00'), 'dd/MM/yyyy')}</div>
                                    <div className="text-xs text-black/40">{order.order_time}</div>
                                  </td>
                                  <td className="p-4">
                                    <div className="font-medium">{order.customer_name}</div>
                                    <div className="text-xs text-black/40">{order.customer_phone}</div>
                                  </td>
                                  <td className="p-4 text-xs max-w-xs">
                                    <div className="flex flex-col gap-0.5">
                                      {order.items.split(/, |\n/).filter(Boolean).map((item, i) => (
                                        <div key={i} className="whitespace-nowrap">{item}</div>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="p-4 font-bold text-emerald-600">${order.total.toFixed(2)}</td>
                                  <td className="p-4">
                                    <span className={cn("px-2 py-1 rounded-full text-[10px] font-bold uppercase", order.payment_method === 'zelle' ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700")}>
                                      {order.payment_method}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {adminTab === 'products' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-6 rounded-3xl border border-black/5 space-y-4">
                        <h3 className="font-semibold flex items-center gap-2">
                          {editingProduct ? <Save size={18}/> : <Plus size={18}/>} 
                          {editingProduct ? 'Editar Produto' : 'Novo Produto'}
                        </h3>
                        <div className="space-y-3">
                          <input 
                            value={editingProduct ? editingProduct.name : newProduct.name}
                            onChange={e => editingProduct 
                              ? setEditingProduct({...editingProduct, name: e.target.value})
                              : setNewProduct({...newProduct, name: e.target.value})
                            }
                            placeholder="Nome" className="w-full p-3 bg-[#fcfbf9] border border-black/5 rounded-xl text-sm" 
                          />
                          <input 
                            type="number"
                            value={editingProduct ? editingProduct.price : newProduct.price}
                            onChange={e => {
                              const val = e.target.value;
                              if (editingProduct) {
                                setEditingProduct({...editingProduct, price: val === '' ? 0 : parseFloat(val)});
                              } else {
                                setNewProduct({...newProduct, price: val});
                              }
                            }}
                            placeholder="Preço" className="w-full p-3 bg-[#fcfbf9] border border-black/5 rounded-xl text-sm" 
                          />
                          <textarea 
                            value={editingProduct ? editingProduct.description : newProduct.description}
                            onChange={e => editingProduct
                              ? setEditingProduct({...editingProduct, description: e.target.value})
                              : setNewProduct({...newProduct, description: e.target.value})
                            }
                            placeholder="Descrição" className="w-full p-3 bg-[#fcfbf9] border border-black/5 rounded-xl text-sm h-20" 
                          />
                          <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-black/40">Imagem do Produto</label>
                            <input 
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const url = await handleFileUpload(file);
                                  if (editingProduct) {
                                    setEditingProduct({...editingProduct, image: url});
                                  } else {
                                    setNewProduct({...newProduct, image: url});
                                  }
                                }
                              }}
                              className="w-full p-3 bg-[#fcfbf9] border border-black/5 rounded-xl text-sm" 
                            />
                            {(editingProduct?.image || newProduct.image) && (
                              <div className="w-full h-32 rounded-xl overflow-hidden border border-black/5 bg-gray-50">
                                <img src={editingProduct ? editingProduct.image : newProduct.image} className="w-full h-full object-cover" alt="Preview" />
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={async () => {
                                const data = editingProduct 
                                  ? { ...editingProduct, price: Number(editingProduct.price) }
                                  : { ...newProduct, price: parseFloat(newProduct.price) || 0 };
                                
                                if (!data.name || data.price <= 0) {
                                  return alert("Por favor, preencha o nome e um preço válido.");
                                }
                                
                                try {
                                  const res = await fetch('/api/products', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(data)
                                  });
                                  
                                  if (!res.ok) throw new Error('Falha ao salvar');

                                  if (editingProduct) {
                                    setEditingProduct(null);
                                  } else {
                                    setNewProduct({ name: '', price: '', description: '', image: '' });
                                  }
                                  await fetchProducts();
                                  alert("Produto salvo com sucesso!");
                                } catch (err) {
                                  console.error("Save error:", err);
                                  alert("Erro ao salvar produto. Tente novamente.");
                                }
                              }}
                              className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-semibold"
                            >
                              {editingProduct ? 'Salvar Alterações' : 'Adicionar'}
                            </button>
                            {editingProduct && (
                              <button 
                                onClick={() => setEditingProduct(null)}
                                className="px-4 py-3 bg-gray-100 text-black/60 rounded-xl font-semibold"
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        {products.map(p => (
                          <div key={p.id} className="bg-white p-4 rounded-2xl border border-black/5 flex items-center gap-4">
                            <img src={p.image} className="w-12 h-12 rounded-lg object-cover" />
                            <div className="flex-1">
                              <div className="font-medium text-sm">{p.name}</div>
                              <div className="text-xs text-emerald-600 font-bold">${p.price.toFixed(2)}</div>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setEditingProduct(p)}
                                className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                              >
                                <Settings size={18} />
                              </button>
                              <button 
                                onClick={async () => {
                                  if (confirm("Excluir produto?")) {
                                    console.log(`Deleting product ${p.id}`);
                                    const res = await fetch(`/api/products/${p.id}`, { method: 'DELETE' });
                                    if (res.ok) {
                                      console.log("Product deleted successfully");
                                      fetchProducts();
                                    } else {
                                      const err = await res.json();
                                      console.error("Delete failed:", err);
                                      alert("Erro ao excluir produto");
                                    }
                                  }
                                }}
                                className="p-2 text-red-400 hover:text-red-600 rounded-lg"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {adminTab === 'settings' && (
                    <div className="max-w-md bg-white p-8 rounded-3xl border border-black/5 space-y-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-widest text-black/40">Nome do Site</label>
                          <input 
                            value={settings.site_name}
                            onChange={e => setSettings({...settings, site_name: e.target.value})}
                            className="w-full p-4 bg-[#fcfbf9] border border-black/5 rounded-2xl"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-widest text-black/40">Logo da Loja</label>
                          <input 
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const url = await handleFileUpload(file);
                                setSettings({...settings, logo_url: url});
                              }
                            }}
                            className="w-full p-4 bg-[#fcfbf9] border border-black/5 rounded-2xl"
                          />
                          {settings.logo_url && (
                            <div className="w-16 h-16 rounded-xl overflow-hidden border border-black/5 mt-2">
                              <img src={settings.logo_url} className="w-full h-full object-cover" alt="Logo Preview" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-widest text-black/40">Limite de Pedidos/Dia</label>
                          <input 
                            type="number"
                            value={settings.capacity_limit}
                            onChange={e => setSettings({...settings, capacity_limit: e.target.value})}
                            className="w-full p-4 bg-[#fcfbf9] border border-black/5 rounded-2xl"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase tracking-widest text-black/40">Nova Senha Admin</label>
                          <input 
                            type="password"
                            placeholder="Deixe em branco para não alterar"
                            id="new-admin-password"
                            className="w-full p-4 bg-[#fcfbf9] border border-black/5 rounded-2xl"
                          />
                        </div>
                        <button 
                          onClick={async () => {
                            const newPassword = (document.getElementById('new-admin-password') as HTMLInputElement).value;
                            const promises = [
                              fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key: 'site_name', value: settings.site_name })
                              }),
                              fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key: 'logo_url', value: settings.logo_url })
                              }),
                              fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key: 'capacity_limit', value: settings.capacity_limit })
                              })
                            ];

                            if (newPassword) {
                              promises.push(fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ key: 'admin_password', value: newPassword })
                              }));
                            }

                            await Promise.all(promises);
                            alert("Configurações salvas!");
                            fetchSettings();
                          }}
                          className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-semibold flex items-center justify-center gap-2"
                        >
                          <Save size={20} /> Salvar Alterações
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {page === 'schedule' && (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-serif font-light">Agendar Pedido</h2>
                <div className="max-w-xl mx-auto p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-sm text-emerald-900">
                  <p className="font-bold mb-1">Informações Importantes:</p>
                  <ul className="list-disc list-inside space-y-1 opacity-80">
                    <li>Atendimento de <strong>Segunda a Sábado</strong>.</li>
                    <li><strong>Domingos</strong> não estamos disponíveis para agendamento.</li>
                    <li>Temos um <strong>limite de capacidade diária</strong> para garantir a qualidade.</li>
                  </ul>
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-black/5 p-8 flex flex-col md:flex-row gap-12">
                <div className="flex-1 relative">
                  {fetchingAvailability && (
                    <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-2xl">
                      <div className="flex items-center gap-2 text-emerald-600 font-medium animate-pulse">
                        <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" />
                        Carregando agenda...
                      </div>
                    </div>
                  )}
                  <label className="block text-sm font-semibold uppercase tracking-wider text-black/40 mb-4">Selecione a Data</label>
                  <DatePicker
                    selected={selectedDate}
                    onChange={handleDateSelect}
                    inline
                    minDate={new Date()}
                    filterDate={(date) => !isSunday(date)}
                    locale={ptBR}
                    dayClassName={(date) => {
                      const dateStr = format(date, 'yyyy-MM-dd');
                      if (isSunday(date)) return "text-gray-300 pointer-events-none";
                      if (availability[dateStr] === 'sold_out') return "bg-red-50 text-red-300 line-through cursor-not-allowed";
                      return "hover:bg-emerald-50 hover:text-emerald-700 transition-colors rounded-full";
                    }}
                  />
                </div>

                <div className="md:w-72 space-y-6">
                  <div className="p-6 bg-[#fcfbf9] rounded-2xl border border-black/5 space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <CalendarIcon size={18} className="text-emerald-600" />
                      Status do Dia
                    </h3>
                    {selectedDate ? (
                      <div className="space-y-2">
                        <p className="text-sm text-black/60">Data selecionada:</p>
                        <p className="text-lg font-medium">{format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
                        <div className={cn(
                          "inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                          availability[format(selectedDate, 'yyyy-MM-dd')] === 'sold_out' 
                            ? "bg-red-100 text-red-700" 
                            : "bg-emerald-100 text-emerald-700"
                        )}>
                          {availability[format(selectedDate, 'yyyy-MM-dd')] === 'sold_out' ? 'Esgotado' : 'Disponível'}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-black/40 italic">Selecione uma data no calendário para ver a disponibilidade.</p>
                    )}

                    {selectedDate && availability[format(selectedDate, 'yyyy-MM-dd')] !== 'sold_out' && (
                      <div className="pt-4 border-t border-black/5 space-y-3">
                        <label className="block text-sm font-semibold uppercase tracking-wider text-black/40">Selecione o Horário</label>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {TIME_SLOTS.map(time => (
                            <button
                              key={time}
                              onClick={() => setOrderData({ ...orderData, time })}
                              className={cn(
                                "py-2 text-xs font-semibold rounded-lg border transition-all",
                                orderData.time === time
                                  ? "bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-100"
                                  : "bg-white border-black/5 text-black/60 hover:border-emerald-200 hover:text-emerald-600"
                              )}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    disabled={!selectedDate || !orderData.time || availability[format(selectedDate, 'yyyy-MM-dd')] === 'sold_out'}
                    onClick={proceedToOrder}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-semibold shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:shadow-none hover:bg-emerald-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    Continuar para Pedido
                  </button>
                </div>
              </div>

              <div className="flex justify-center gap-8 text-xs font-semibold text-black/40 uppercase tracking-widest">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" /> Disponível
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-200" /> Esgotado
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gray-200" /> Fechado
                </div>
              </div>
            </motion.div>
          )}

          {page === 'order' && (
            <motion.div
              key="order"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <button 
                onClick={() => {
                  window.history.pushState({}, '', '/');
                  setPage('schedule');
                }}
                className="text-sm font-semibold text-emerald-600 hover:underline flex items-center gap-1"
              >
                ← Voltar para a agenda
              </button>

              <div className="text-center space-y-2">
                <h2 className="text-4xl font-serif font-light">Detalhes do Pedido</h2>
                <p className="text-black/60">Data escolhida: <span className="font-semibold text-black">{selectedDate && format(selectedDate, 'dd/MM/yyyy')} às {orderData.time}</span></p>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-black/5 p-8 max-w-2xl mx-auto">
                <form onSubmit={submitOrder} className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-black/60 uppercase tracking-wider">Seu Nome</label>
                      <input
                        required
                        type="text"
                        value={orderData.name}
                        onChange={e => setOrderData({ ...orderData, name: e.target.value })}
                        className="w-full p-4 bg-[#fcfbf9] border border-black/5 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        placeholder="Nome completo"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-black/60 uppercase tracking-wider">Telefone</label>
                      <input
                        required
                        type="tel"
                        value={orderData.phone}
                        onChange={handlePhoneChange}
                        className={cn(
                          "w-full p-4 bg-[#fcfbf9] border rounded-2xl focus:outline-none focus:ring-2 transition-all",
                          phoneError 
                            ? "border-red-500 focus:ring-red-500/20 focus:border-red-500" 
                            : "border-black/5 focus:ring-emerald-500/20 focus:border-emerald-500"
                        )}
                        placeholder="(000) 000-0000"
                      />
                      {phoneError && (
                        <p className="text-xs text-red-500 font-medium">{phoneError}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-semibold text-black/60 uppercase tracking-wider block">Forma de Pagamento</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setOrderData({ ...orderData, paymentMethod: 'zelle' })}
                        className={cn(
                          "p-4 rounded-2xl border text-sm font-semibold transition-all flex flex-col items-center gap-2",
                          orderData.paymentMethod === 'zelle'
                            ? "bg-emerald-50 border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20"
                            : "bg-white border-black/5 text-black/40 hover:border-black/20"
                        )}
                      >
                        <span>Zelle</span>
                        <span className="text-[10px] opacity-60">7708757348</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderData({ ...orderData, paymentMethod: 'cash' })}
                        className={cn(
                          "p-4 rounded-2xl border text-sm font-semibold transition-all flex flex-col items-center gap-2",
                          orderData.paymentMethod === 'cash'
                            ? "bg-emerald-50 border-emerald-500 text-emerald-700 ring-2 ring-emerald-500/20"
                            : "bg-white border-black/5 text-black/40 hover:border-black/20"
                        )}
                      >
                        <span>Cash</span>
                        <span className="text-[10px] opacity-60">Na entrega</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-semibold text-black/60 uppercase tracking-wider block">Escolha os Itens</label>
                    <div className="max-h-[400px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                      {products.map(product => (
                        <div key={product.id} className="flex items-center gap-4 p-4 bg-[#fcfbf9] rounded-2xl border border-black/5 hover:border-emerald-200 transition-colors">
                          <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 border border-black/5">
                            <img 
                              src={product.image} 
                              alt={product.name} 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{product.name}</p>
                            <p className="text-[10px] text-black/40 line-clamp-2 leading-tight mb-1">{product.description}</p>
                            <p className="text-xs text-emerald-600 font-bold uppercase tracking-wider">${product.price.toFixed(2)}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(product.id, -1)}
                              className="w-8 h-8 rounded-full border border-black/10 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              -
                            </button>
                            <span className="w-4 text-center font-bold text-sm">{orderData.selectedItems[product.id] || 0}</span>
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(product.id, 1)}
                              className="w-8 h-8 rounded-full border border-black/10 flex items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-6 bg-emerald-900 text-white rounded-3xl flex justify-between items-center">
                    <span className="text-sm uppercase tracking-widest font-bold opacity-60">Total do Pedido</span>
                    <span className="text-3xl font-serif">${total.toFixed(2)}</span>
                  </div>

                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                    <AlertCircle className="text-amber-600 shrink-0" size={20} />
                    <div className="text-sm text-amber-900">
                      <p className="font-bold">Aviso de Pagamento</p>
                      <p>Pagamento: Via Zelle or Cash. Our Zelle: 7708757348. Pedido sujeito à confirmação manual após envio no WhatsApp.</p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || total === 0}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-semibold shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {loading ? 'Processando...' : 'Confirmar e Gerar Resumo'}
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {page === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center space-y-8 py-12"
            >
              <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 size={48} />
              </div>
              <div className="space-y-2">
                <h2 className="text-4xl font-serif font-light">Pedido Recebido!</h2>
                <p className="text-black/60 text-lg">Agora, envie os detalhes para nosso WhatsApp para confirmação final.</p>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-black/5 p-8 max-w-md mx-auto space-y-6">
                <div className="text-left space-y-3">
                  <div className="flex justify-between text-sm border-b border-black/5 pb-2">
                    <span className="text-black/40 uppercase tracking-wider font-semibold">Cliente</span>
                    <span className="font-medium">{orderData.name}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-black/5 pb-2">
                    <span className="text-black/40 uppercase tracking-wider font-semibold">Telefone</span>
                    <span className="font-medium">{orderData.phone}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-black/5 pb-2">
                    <span className="text-black/40 uppercase tracking-wider font-semibold">Data</span>
                    <span className="font-medium">{selectedDate && format(selectedDate, 'dd/MM/yyyy')} às {orderData.time}</span>
                  </div>
                  <div className="flex justify-between text-sm border-b border-black/5 pb-2">
                    <span className="text-black/40 uppercase tracking-wider font-semibold">Total</span>
                    <span className="font-medium text-emerald-600 font-serif text-xl">${total.toFixed(2)}</span>
                  </div>
                </div>

                <div className="text-left space-y-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-black/40">Itens do Pedido</span>
                  <div className="space-y-1">
                    {Object.entries(orderData.selectedItems).map(([id, qty]) => {
                      const product = products.find(p => String(p.id) === String(id));
                      const q = qty as number;
                      return (
                        <div key={id} className="flex justify-between text-sm">
                          <span className="text-black/60">{q}x {product?.name}</span>
                          <span className="font-medium">${((product?.price || 0) * q).toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-xs text-amber-900 text-left">
                  {orderData.paymentMethod === 'zelle' ? (
                    <>
                      <strong>Atenção:</strong> O pagamento deve ser realizado Via Zelle. Our Zelle: 7708757348. Envie o comprovante junto com a mensagem abaixo.
                    </>
                  ) : (
                    <>
                      <strong>Atenção:</strong> Você escolheu pagamento em <strong>Dinheiro (Cash)</strong>. Por favor, tenha o valor exato no momento da entrega/retirada. Envie a mensagem abaixo para confirmar.
                    </>
                  )}
                </div>

                <button
                  onClick={sendWhatsApp}
                  className="w-full py-4 bg-[#25D366] text-white rounded-2xl font-semibold shadow-lg shadow-green-100 hover:bg-[#128C7E] transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <MessageSquare size={20} />
                  Enviar para WhatsApp
                </button>
              </div>

              <button 
                onClick={() => {
                  window.history.pushState({}, '', '/');
                  window.location.reload();
                }}
                className="text-sm font-semibold text-black/40 hover:text-black transition-colors"
              >
                Fazer outro agendamento
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-black/5 text-center text-sm text-black/40">
        <p>© 2026 Vovó's Baked Goods. Todos os direitos reservados.</p>
        <p className="mt-1 italic">Produção limitada para garantir a melhor qualidade.</p>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.1);
        }
      `}</style>
    </div>
  );
}
