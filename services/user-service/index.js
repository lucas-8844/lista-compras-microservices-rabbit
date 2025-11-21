import express from 'express';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import JsonDatabase from '../../shared/JsonDatabase.js';
import { autoRegister } from '../../shared/serviceRegistry.js';

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const db = new JsonDatabase(path.join(process.cwd(), 'data', 'users.json'));

app.use(express.json());
app.use(morgan('dev'));

function userPublic(u){
  const { password, ...rest } = u;
  return rest;
}

function authMiddleware(req, res, next){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

app.get('/health', (req,res)=> res.json({ status:'ok', service:'user-service' }));

app.post('/auth/register', async (req,res)=>{
  try{
    const { email, username, password, firstName, lastName, preferences={} } = req.body;
    if(!email || !username || !password) return res.status(400).json({ error:'Campos obrigatórios: email, username, password' });
    const users = db.read();
    if (users.some(u => u.email === email)) return res.status(409).json({ error:'Email já cadastrado' });
    if (users.some(u => u.username === username)) return res.status(409).json({ error:'Username já cadastrado' });
    const hash = await bcrypt.hash(password, 10);
    const now = Date.now();
    const user = {
      id: uuidv4(),
      email, username, password: hash,
      firstName: firstName || '', lastName: lastName || '',
      preferences: {
        defaultStore: preferences.defaultStore || '',
        currency: preferences.currency || 'BRL'
      },
      createdAt: now, updatedAt: now
    };
    db.upsert(user);
    const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ user: userPublic(user), token });
  }catch(e){ res.status(500).json({ error:'Erro interno' }); }
});

app.post('/auth/login', async (req,res)=>{
  const { identifier, password } = req.body;
  if(!identifier || !password) return res.status(400).json({ error:'identifier e password são obrigatórios' });
  const users = db.read();
  const u = users.find(x => x.email === identifier || x.username === identifier);
  if(!u) return res.status(401).json({ error:'Credenciais inválidas' });
  const ok = await bcrypt.compare(password, u.password);
  if(!ok) return res.status(401).json({ error:'Credenciais inválidas' });
  const token = jwt.sign({ id: u.id, email: u.email, username: u.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ user: userPublic(u), token });
});

app.get('/users/:id', authMiddleware, (req,res)=>{
  const u = db.findById(req.params.id);
  if(!u) return res.status(404).json({ error:'Usuário não encontrado' });
  if (req.user.id !== u.id) return res.status(403).json({ error:'Acesso negado' });
  res.json({ user: userPublic(u) });
});

app.put('/users/:id', authMiddleware, (req,res)=>{
  const u = db.findById(req.params.id);
  if(!u) return res.status(404).json({ error:'Usuário não encontrado' });
  if (req.user.id !== u.id) return res.status(403).json({ error:'Acesso negado' });
  const { firstName, lastName, preferences } = req.body;
  u.firstName = firstName ?? u.firstName;
  u.lastName = lastName ?? u.lastName;
  u.preferences = { ...u.preferences, ...(preferences||{}) };
  u.updatedAt = Date.now();
  db.upsert(u);
  res.json({ user: userPublic(u) });
});

app.listen(PORT, ()=>{
  autoRegister({ name:'user-service', port: PORT });
  console.log(`✅ User Service na porta ${PORT}`);
});
