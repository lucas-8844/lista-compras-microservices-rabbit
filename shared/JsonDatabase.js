import fs from 'fs';
import path from 'path';

export default class JsonDatabase {
  constructor(filePath){
    this.filePath = filePath;
    this.ensureFile();
  }
  ensureFile(){
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
  }
  read(){
    return JSON.parse(fs.readFileSync(this.filePath, 'utf-8') || '[]');
  }
  write(data){
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
  findById(id){
    return this.read().find(x => x.id === id) || null;
  }
  upsert(obj, idField='id'){
    const data = this.read();
    const idx = data.findIndex(x => x[idField] === obj[idField]);
    if (idx >= 0){ data[idx] = obj; } else { data.push(obj); }
    this.write(data);
    return obj;
  }
  removeById(id){
    const data = this.read();
    const next = data.filter(x => x.id !== id);
    this.write(next);
    return data.length - next.length;
  }
}
