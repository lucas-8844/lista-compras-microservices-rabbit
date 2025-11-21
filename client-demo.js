const BASE = 'http://localhost:3000/api';

async function main(){
  console.log('=== DEMO CLIENT ===');

  // 1) Registro
  const email = `aluno${Date.now()}@teste.com`;
  let r = await fetch(`${BASE}/auth/register`, {
    method:'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({ email, username: email.split('@')[0], password:'123456', firstName:'Aluno', lastName:'Teste' })
  });
  const reg = await r.json();
  if (!r.ok){ console.log('Falha registro', reg); return; }
  console.log('Usuário registrado:', reg.user.email);

  const token = reg.token;
  const authH = { authorization: `Bearer ${token}`, 'content-type':'application/json' };

  // 2) Buscar itens (catálogo)
  r = await fetch(`${BASE}/items?category=Alimentos`);
  const itens = await r.json();
  console.log('Itens alimentos:', itens.items.length);

  // 3) Criar lista
  r = await fetch(`${BASE}/lists`, { method:'POST', headers: authH, body: JSON.stringify({ name:'Mercado da semana', description:'Compras' }) });
  const l = await r.json();
  console.log('Lista criada:', l.list.id);

  // 4) Adicionar item à lista
  const firstItem = itens.items[0];
  r = await fetch(`${BASE}/lists/${l.list.id}/items`, { method:'POST', headers: authH, body: JSON.stringify({ itemId: firstItem.id, quantity: 2 }) });
  const l2 = await r.json();
  console.log('Item adicionado. Total items:', l2.list.items.length);

  // 5) Dashboard agregado
  r = await fetch(`${BASE}/dashboard`, { headers: authH });
  const dash = await r.json();
  console.log('Dashboard:', dash);

  // 6) Busca global
  r = await fetch(`${BASE}/search?q=arroz`, { headers: authH });
  const search = await r.json();
  console.log('Busca global (itens):', search.items.length);
}

main().catch(e=> console.error(e));
