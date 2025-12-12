import express from 'express';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { ServiceRegistry } from '../shared/serviceRegistry.js';

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const registry = new ServiceRegistry();

app.use(express.json());
app.use(morgan('dev'));

/* ================= CIRCUIT BREAKER ================= */

const circuits = {};
const MAX_FAILS = 3;
const OPEN_TIME_MS = 30_000;

function isOpen(name){
  const c = circuits[name];
  return c && c.openUntil && c.openUntil > Date.now();
}
function recordFail(name){
  const c = circuits[name] || { failures:0, openUntil:0 };
  c.failures += 1;
  if (c.failures >= MAX_FAILS){
    c.openUntil = Date.now() + OPEN_TIME_MS;
  }
  circuits[name] = c;
}
function recordSuccess(name){
  circuits[name] = { failures:0, openUntil:0 };
}

/* ================= PROXY SEGURO ================= */

async function proxyTo(serviceName, req, res){
  if (isOpen(serviceName)) {
    return res.status(503).json({ error:`Circuito aberto para ${serviceName}` });
  }

  const svc = registry.discover(serviceName);
  if (!svc) {
    return res.status(503).json({ error:`Serviço ${serviceName} indisponível` });
  }

  // monta URL de forma segura (SEM bug de concatenação)
  const targetUrl = new URL(req.originalUrl.replace('/api',''), `http://${svc.host}:${svc.port}`).toString();

  try {
    const init = {
      method: req.method,
      headers: { ...req.headers }
    };
    delete init.headers.host;

    if (!['GET','HEAD'].includes(req.method)) {
      init.body = JSON.stringify(req.body);
      init.headers['content-type'] = 'application/json';
    }

    const resp = await fetch(targetUrl, init);
    recordSuccess(serviceName);

    const text = await resp.text();
    res.status(resp.status);

    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (e) {
    recordFail(serviceName);
    res.status(502).json({
      error:`Falha ao encaminhar para ${serviceName}`,
      details: e.message
    });
  }
}

/* ================= AUTH ================= */

function ensureAuth(req,res,next){
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error:'Token ausente' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error:'Token inválido' });
  }
}

/* ================= ROTAS PROXY ================= */

app.use('/api/auth', (req,res)=> proxyTo('user-service', req, res));
app.use('/api/users', ensureAuth, (req,res)=> proxyTo('user-service', req, res));
app.use('/api/items', (req,res)=> proxyTo('item-service', req, res));
app.use('/api/lists', ensureAuth, (req,res)=> proxyTo('list-service', req, res));

/* ================= ROTAS AGREGADAS ================= */

app.get('/api/dashboard', ensureAuth, async (req,res)=>{
  try{
    const listSvc = registry.discover('list-service');
    const itemsSvc = registry.discover('item-service');
    if (!listSvc || !itemsSvc) {
      return res.status(503).json({ error:'Serviços indisponíveis' });
    }

    const [listsResp, catsResp] = await Promise.all([
      fetch(`http://${listSvc.host}:${listSvc.port}/lists`, {
        headers:{ authorization: req.headers.authorization }
      }),
      fetch(`http://${itemsSvc.host}:${itemsSvc.port}/categories`)
    ]);

    const lists = await listsResp.json();
    const cats = await catsResp.json();

    res.json({
      userId: req.user.id,
      totalLists: (lists.lists||[]).length,
      categories: cats.categories||[],
      lastUpdate: Date.now()
    });
  } catch(e){
    res.status(500).json({ error:'Falha no dashboard', details: e.message });
  }
});

app.get('/api/search', async (req,res)=>{
  try{
    const itemsSvc = registry.discover('item-service');
    const listSvc = registry.discover('list-service');
    if (!itemsSvc) {
      return res.status(503).json({ error:'Item Service indisponível' });
    }

    const q = encodeURIComponent(req.query.q || '');
    const [itemsR, listsR] = await Promise.all([
      fetch(`http://${itemsSvc.host}:${itemsSvc.port}/search?q=${q}`),
      req.headers.authorization && listSvc
        ? fetch(`http://${listSvc.host}:${listSvc.port}/lists`, {
            headers:{ authorization: req.headers.authorization }
          })
        : Promise.resolve({ ok:true, json: async()=>({ lists: []}) })
    ]);

    const items = await itemsR.json();
    const lists = await listsR.json();

    res.json({
      items: items.items||[],
      lists: lists.lists||[]
    });
  } catch(e){
    res.status(500).json({ error:'Falha na busca global', details: e.message });
  }
});

/* ================= UTIL ================= */

app.get('/health', async (req,res)=>{
  const services = registry.list();
  const statuses = await Promise.all(services.map(async s=>{
    try{
      const r = await fetch(`http://${s.host}:${s.port}${s.healthPath||'/health'}`);
      return { ...s, ok: r.ok };
    } catch {
      return { ...s, ok:false };
    }
  }));
  res.json({ gateway:'ok', services: statuses });
});

app.get('/registry', (req,res)=> res.json({ services: registry.list() }));

app.listen(PORT, ()=>{
  console.log(`🌐 API Gateway na porta ${PORT}`);
});
