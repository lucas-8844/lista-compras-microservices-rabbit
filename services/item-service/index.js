import express from 'express';
import morgan from 'morgan';
import path from 'path';
import JsonDatabase from '../../shared/JsonDatabase.js';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { autoRegister } from '../../shared/serviceRegistry.js';

const app = express();
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const db = new JsonDatabase(path.join(process.cwd(), 'services', 'item-service', 'data', 'items.json'));

app.use(express.json());
app.use(morgan('dev'));

function auth(req,res,next){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if(!token) return res.status(401).json({ error:'Token ausente' });
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error:'Token inválido' }); }
}

app.get('/health',(req,res)=> res.json({ status:'ok', service:'item-service' }));

app.get('/items', (req,res)=>{
  const { category, name } = req.query;
  let data = db.read().filter(x=> x.active);
  if (category) data = data.filter(x => x.category.toLowerCase() === String(category).toLowerCase());
  if (name) data = data.filter(x => x.name.toLowerCase().includes(String(name).toLowerCase()));
  res.json({ items: data });
});

app.get('/items/:id', (req,res)=>{
  const it = db.findById(req.params.id);
  if(!it || !it.active) return res.status(404).json({ error:'Item não encontrado' });
  res.json({ item: it });
});

app.post('/items', auth, (req,res)=>{
  const { name, category, brand, unit, averagePrice, barcode, description, active=true } = req.body;
  if(!name || !category || !unit) return res.status(400).json({ error:'Campos obrigatórios: name, category, unit' });
  const item = { id: uuidv4(), name, category, brand: brand||'', unit, averagePrice: Number(averagePrice||0), barcode: barcode||'', description: description||'', active: !!active, createdAt: Date.now() };
  db.upsert(item);
  res.status(201).json({ item });
});

app.put('/items/:id', auth, (req,res)=>{
  const it = db.findById(req.params.id);
  if(!it) return res.status(404).json({ error:'Item não encontrado' });
  const up = req.body;
  Object.assign(it, up, { averagePrice: up.averagePrice!=null ? Number(up.averagePrice) : it.averagePrice });
  db.upsert(it);
  res.json({ item: it });
});

app.get('/categories', (req,res)=>{
  const set = new Set(db.read().filter(x=>x.active).map(x=>x.category));
  res.json({ categories: Array.from(set).sort() });
});

app.get('/search', (req,res)=>{
  const q = String(req.query.q||'').toLowerCase();
  const data = db.read().filter(x=> x.active && (x.name.toLowerCase().includes(q) || x.brand.toLowerCase().includes(q)));
  res.json({ items: data });
});

app.listen(PORT, ()=>{
  autoRegister({ name:'item-service', port: PORT });
  console.log(`✅ Item Service na porta ${PORT}`);
});
