import express from 'express';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import JsonDatabase from '../../shared/JsonDatabase.js';
import { autoRegister, ServiceRegistry } from '../../shared/serviceRegistry.js';
import { publishEvent } from '../../shared/rabbit-producer.js';

const app = express();
const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const db = new JsonDatabase(path.join(process.cwd(), 'data', 'lists.json'));

app.use(express.json());
app.use(morgan('dev'));

/* ================= AUTH ================= */

function auth(req, res, next){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error:'Token ausente' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error:'Token inválido' });
  }
}

app.get('/health', (req,res)=> res.json({ status:'ok', service:'list-service' }));

/* ================= HELPERS ================= */

function summarize(list){
  const totalItems = list.items.length;
  const purchasedItems = list.items.filter(i=> i.purchased).length;
  const estimatedTotal = list.items.reduce(
    (acc, i)=> acc + Number(i.estimatedPrice||0) * Number(i.quantity||1),
    0
  );
  list.summary = {
    totalItems,
    purchasedItems,
    estimatedTotal: Number(estimatedTotal.toFixed(2))
  };
  return list.summary;
}

async function fetchItem(itemId){
  const reg = new ServiceRegistry();
  const svc = reg.discover('item-service');
  if (!svc) throw new Error('Item Service indisponível');
  const resp = await fetch(`http://${svc.host}:${svc.port}/items/${itemId}`);
  if (!resp.ok) throw new Error('Item não encontrado');
  const { item } = await resp.json();
  return item;
}

/* ================= CHECKOUT (ÚNICO E CORRETO) ================= */

app.post('/lists/:id/checkout', auth, async (req, res) => {
  try {
    const listId = req.params.id;

    const payload = {
      listId,
      userEmail: req.user.email,
      at: Date.now()
    };

    console.log('📦 Checkout iniciado:', payload);

    await publishEvent(
      'shopping_events',
      'list.checkout.completed',
      payload
    );

    return res.status(202).json({
      status: 'Checkout iniciado',
      listId
    });

  } catch (err) {
    console.error('❌ ERRO NO CHECKOUT:', err);
    return res.status(500).json({
      error: 'Checkout falhou',
      details: err.message
    });
  }
});

/* ================= CRUD LISTAS ================= */

app.post('/lists', auth, (req,res)=>{
  const { name, description } = req.body;
  if(!name) return res.status(400).json({ error:'name é obrigatório' });

  const now = Date.now();
  const list = {
    id: uuidv4(),
    userId: req.user.id,
    name,
    description: description||'',
    status: 'active',
    items: [],
    summary: { totalItems:0, purchasedItems:0, estimatedTotal:0 },
    createdAt: now,
    updatedAt: now
  };

  db.upsert(list);
  res.status(201).json({ list });
});

app.get('/lists', auth, (req,res)=>{
  const all = db.read().filter(l => l.userId === req.user.id);
  res.json({ lists: all });
});

app.get('/lists/:id', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id)
    return res.status(404).json({ error:'Lista não encontrada' });

  summarize(l);
  res.json({ list: l });
});

app.put('/lists/:id', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id)
    return res.status(404).json({ error:'Lista não encontrada' });

  const { name, description, status } = req.body;
  if (name) l.name = name;
  if (description != null) l.description = description;
  if (status) l.status = status;

  l.updatedAt = Date.now();
  summarize(l);
  db.upsert(l);

  res.json({ list: l });
});

app.delete('/lists/:id', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id)
    return res.status(404).json({ error:'Lista não encontrada' });

  db.removeById(l.id);
  res.json({ success:true });
});

/* ================= ITENS ================= */

app.post('/lists/:id/items', auth, async (req,res)=>{
  try {
    const l = db.findById(req.params.id);
    if(!l || l.userId !== req.user.id)
      return res.status(404).json({ error:'Lista não encontrada' });

    const { itemId, quantity=1, estimatedPrice, notes='' } = req.body;
    if(!itemId) return res.status(400).json({ error:'itemId é obrigatório' });

    const item = await fetchItem(itemId);

    l.items.push({
      itemId,
      itemName: item.name,
      quantity: Number(quantity),
      unit: item.unit,
      estimatedPrice: Number(estimatedPrice ?? item.averagePrice ?? 0),
      purchased: false,
      notes,
      addedAt: Date.now()
    });

    l.updatedAt = Date.now();
    summarize(l);
    db.upsert(l);

    res.status(201).json({ list: l });

  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/lists/:id/items/:itemId', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id)
    return res.status(404).json({ error:'Lista não encontrada' });

  const idx = l.items.findIndex(i=> i.itemId === req.params.itemId);
  if(idx < 0)
    return res.status(404).json({ error:'Item não está na lista' });

  const changes = req.body;
  l.items[idx] = {
    ...l.items[idx],
    ...changes,
    quantity: changes.quantity != null ? Number(changes.quantity) : l.items[idx].quantity,
    estimatedPrice: changes.estimatedPrice != null ? Number(changes.estimatedPrice) : l.items[idx].estimatedPrice
  };

  l.updatedAt = Date.now();
  summarize(l);
  db.upsert(l);

  res.json({ list: l });
});

app.delete('/lists/:id/items/:itemId', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id)
    return res.status(404).json({ error:'Lista não encontrada' });

  l.items = l.items.filter(i => i.itemId !== req.params.itemId);
  l.updatedAt = Date.now();
  summarize(l);
  db.upsert(l);

  res.json({ list: l });
});

app.get('/lists/:id/summary', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id)
    return res.status(404).json({ error:'Lista não encontrada' });

  res.json({ summary: summarize(l) });
});

/* ================= START ================= */

app.listen(PORT, ()=>{
  autoRegister({ name:'list-service', port: PORT });
  console.log(`✅ List Service na porta ${PORT}`);
});

/* ================= SAFETY ================= */

process.on('unhandledRejection', e =>
  console.error('❌ unhandledRejection', e)
);
process.on('uncaughtException', e =>
  console.error('❌ uncaughtException', e)
);
