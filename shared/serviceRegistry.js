import fs from 'fs';
import path from 'path';

const DEFAULT_FILE = process.env.SERVICE_REGISTRY_FILE || path.join(process.cwd(), 'services.registry.json');
const HEARTBEAT_INTERVAL = 30_000;

function now(){ return Date.now(); }

export class ServiceRegistry {
  constructor(filePath = DEFAULT_FILE){
    this.filePath = filePath;
    this.ensureFile();
    this.services = this.read();
  }
  ensureFile(){
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, JSON.stringify({ services: {} }, null, 2));
  }
  read(){
    return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
  }
  write(obj){
    fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
  }
  register(name, host, port, healthPath = '/health'){
    const data = this.read();
    const key = `${name}-${host}:${port}`;
    data.services[key] = { name, host, port, healthPath, lastHeartbeat: now() };
    this.write(data);
    return key;
  }
  heartbeat(key){
    const data = this.read();
    if (data.services[key]){
      data.services[key].lastHeartbeat = now();
      this.write(data);
    }
  }
  unregister(key){
    const data = this.read();
    delete data.services[key];
    this.write(data);
  }
  list(){ return Object.values(this.read().services); }
  discover(name){
    const items = this.list().filter(s => s.name === name);
    // round-robin simples: ordena por lastHeartbeat
    items.sort((a,b)=> (a.lastHeartbeat||0) - (b.lastHeartbeat||0));
    return items[0] || null;
  }
}

export function autoRegister({ name, host='localhost', port, healthPath='/health' }){
  const reg = new ServiceRegistry();
  const key = reg.register(name, host, port, healthPath);
  const intv = setInterval(()=>{
    try { reg.heartbeat(key); } catch {}
  }, HEARTBEAT_INTERVAL);
  const cleanup = ()=> { try{ clearInterval(intv); reg.unregister(key); } catch {} };
  process.on('SIGINT', cleanup);
  process.on('exit', cleanup);
  return reg;
}
