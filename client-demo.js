const BASE = 'http://localhost:3000/api';

async function readBody(res) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let json = null;
  if (ct.includes('application/json')) {
    try { json = JSON.parse(text); } catch {}
  }
  return { ct, text, json };
}

async function must(res, label, url) {
  const body = await readBody(res);
  if (!res.ok) {
    console.log(`❌ ${label} falhou (${res.status}) → ${url}`);
    if (body.json) console.log(body.json);
    else console.log(body.text.slice(0, 300));
    throw new Error(`${label} failed`);
  }
  return body.json ?? body.text;
}

async function main() {
  console.log('=== DEMO CLIENT ===');

  // 1) Registro
  const email = `aluno${Date.now()}@teste.com`;
  const urlReg = `${BASE}/auth/register`;
  let r = await fetch(urlReg, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      username: email.split('@')[0],
      password: '123456',
      firstName: 'Aluno',
      lastName: 'Teste',
    }),
  });

  const reg = await must(r, 'Registro', urlReg);
  console.log('Usuário registrado:', reg.user.email);

  const token = reg.token;
  console.log('TOKEN:', token);
  const authH = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // 2) Buscar itens
  const urlItems = `${BASE}/items?category=Alimentos`;
  r = await fetch(urlItems);
  const itens = await must(r, 'Buscar itens', urlItems);
  console.log('Itens alimentos:', itens.items.length);

  // 3) Criar lista
  const urlLists = `${BASE}/lists`;
  r = await fetch(urlLists, {
    method: 'POST',
    headers: authH,
    body: JSON.stringify({ name: 'Mercado da semana', description: 'Compras' }),
  });
  const l = await must(r, 'Criar lista', urlLists);
  console.log('Lista criada:', l.list.id);

  // 4) Adicionar item
  const firstItem = itens.items[0];
  const urlAdd = `${BASE}/lists/${l.list.id}/items`;
  r = await fetch(urlAdd, {
    method: 'POST',
    headers: authH,
    body: JSON.stringify({ itemId: firstItem.id, quantity: 2 }),
  });
  const l2 = await must(r, 'Adicionar item', urlAdd);
  console.log('Item adicionado. Total items:', l2.list.items.length);

  // 5) Dashboard
  const urlDash = `${BASE}/dashboard`;
  r = await fetch(urlDash, { headers: authH });
  const dash = await must(r, 'Dashboard', urlDash);
  console.log('Dashboard:', dash);

  // 6) Busca global
  const urlSearch = `${BASE}/search?q=arroz`;
  r = await fetch(urlSearch, { headers: authH });
  const search = await must(r, 'Busca global', urlSearch);
  console.log('Busca global (itens):', search.items.length);

  // 7) Checkout
  const urlCheckout = `${BASE}/lists/${l.list.id}/checkout`;
  r = await fetch(urlCheckout, { method: 'POST', headers: authH });
  const checkoutBody = await readBody(r);
  console.log('Checkout:', r.status, checkoutBody.json ?? checkoutBody.text);
}

main().catch((e) => console.error('❌ Erro geral:', e.message));
