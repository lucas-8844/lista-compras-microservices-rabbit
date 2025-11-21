import express from 'express';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import JsonDatabase from '../../shared/JsonDatabase.js';
import { autoRegister, ServiceRegistry } from '../../shared/serviceRegistry.js';
import { publishEvent } from '../shared/rabbit-producer.js';

const app = express();
const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const db = new JsonDatabase(path.join(process.cwd(), 'data', 'lists.json'));

app.use(express.json());
app.use(morgan('dev'));

function auth(req,res,next){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token) return res.status(401).json({ error:'Token ausente' });
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error:'Token inválido' }); }
}

app.get('/health',(req,res)=> res.json({ status:'ok', service:'list-service' }));

// Helpers
function summarize(list){
  const totalItems = list.items.length;
  const purchasedItems = list.items.filter(i=> i.purchased).length;
  const estimatedTotal = list.items.reduce((acc, i)=> acc + Number(i.estimatedPrice||0) * Number(i.quantity||1), 0);
  list.summary = { totalItems, purchasedItems, estimatedTotal: Number(estimatedTotal.toFixed(2)) };
  return list.summary;
}

async function fetchItem(itemId){
  const reg = new ServiceRegistry();
  const svc = reg.discover('item-service');
  if (!svc) throw new Error('Item Service indisponível');
  const base = `http://${svc.host}:${svc.port}`;
  const resp = await fetch(`${base}/items/${itemId}`);
  if (!resp.ok) throw new Error('Item não encontrado');
  const { item } = await resp.json();
  return item;
}

// Endpoints
app.post("/lists/:id/checkout", async (req, res) => {
  const listId = req.params.id;

  const list = db.getList(listId);
  if (!list) {
    return res.status(404).json({ error: "List not found" });
  }

  // 🚀 1. Publicar evento no RabbitMQ
  const channel = await rabbit.getChannel();
  await channel.assertExchange("shopping_events", "topic", { durable: true });

  channel.publish(
    "shopping_events",
    "list.checkout.completed",
    Buffer.from(JSON.stringify(list))
  );

  console.log("📤 Evento enviado para RabbitMQ!");

  // 🚀 2. Resposta rápida ao cliente
  return res.status(202).json({
    message: "Checkout solicitado. Processamento assíncrono iniciado."
  });
});

app.post('/lists', auth, (req,res)=>{
  const { name, description } = req.body;
  if(!name) return res.status(400).json({ error:'name é obrigatório' });
  const now = Date.now();
  const list = {
    id: uuidv4(),
    userId: req.user.id,
    name, description: description||'',
    status: 'active',
    items: [],
    summary: { totalItems:0, purchasedItems:0, estimatedTotal:0 },
    createdAt: now, updatedAt: now
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
  if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
  summarize(l);
  res.json({ list: l });
});

app.put('/lists/:id', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
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
  if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
  db.removeById(l.id);
  res.json({ success:true });
});

app.post('/lists/:id/items', auth, async (req,res)=>{
  try{
    const l = db.findById(req.params.id);
    if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
    const { itemId, quantity=1, estimatedPrice, notes='' } = req.body;
    if(!itemId) return res.status(400).json({ error:'itemId é obrigatório' });
    const item = await fetchItem(itemId);
    const entry = {
      itemId,
      itemName: item.name,
      quantity: Number(quantity),
      unit: item.unit,
      estimatedPrice: Number(estimatedPrice ?? item.averagePrice ?? 0),
      purchased: false,
      notes,
      addedAt: Date.now()
    };
    l.items.push(entry);
    l.updatedAt = Date.now();
    summarize(l);
    db.upsert(l);
    res.status(201).json({ list: l });
  }catch(e){ res.status(400).json({ error: e.message }); }
});

app.put('/lists/:id/items/:itemId', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
  const idx = l.items.findIndex(i=> i.itemId === req.params.itemId);
  if(idx<0) return res.status(404).json({ error:'Item não está na lista' });
  const changes = req.body;
  l.items[idx] = { ...l.items[idx], ...changes, quantity: changes.quantity!=null? Number(changes.quantity): l.items[idx].quantity, estimatedPrice: changes.estimatedPrice!=null? Number(changes.estimatedPrice): l.items[idx].estimatedPrice };
  l.updatedAt = Date.now();
  summarize(l);
  db.upsert(l);
  res.json({ list: l });
});

app.delete('/lists/:id/items/:itemId', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
  l.items = l.items.filter(i => i.itemId !== req.params.itemId);
  l.updatedAt = Date.now();
  summarize(l);
  db.upsert(l);
  res.json({ list: l });
});

app.get('/lists/:id/summary', auth, (req,res)=>{
  const l = db.findById(req.params.id);
  if(!l || l.userId !== req.user.id) return res.status(404).json({ error:'Lista não encontrada' });
  res.json({ summary: summarize(l) });
});

app.listen(PORT, ()=>{
  autoRegister({ name:'list-service', port: PORT });
  console.log(`✅ List Service na porta ${PORT}`);
});
// Exemplo simples de checkout
app.post('/lists/:id/checkout', async (req, res) => {
  const listId = req.params.id;

  try {
    // Aqui você poderia buscar a lista real no banco.
    // Por enquanto vamos simular os dados:
    const event = {
      listId,
      userEmail: req.user?.email || 'user@example.com',
      items: [
        { name: 'Arroz', price: 10, quantity: 2 },
        { name: 'Feijão', price: 8, quantity: 1 },
      ],
      timestamp: Date.now(),
    };

    // Publica no RabbitMQ
    await publishEvent(
      'shopping_events',
      'list.checkout.completed',
      event
    );

    // Responde rapidamente (202 Accepted)
    return res.status(202).json({
      message: 'Checkout recebido e será processado assíncronamente',
      listId,
    });
  } catch (e) {
    console.error('❌ Erro no checkout:', e);
    return res.status(500).json({
      error: 'Falha ao processar checkout',
      details: e.message,
    });
  }
});

