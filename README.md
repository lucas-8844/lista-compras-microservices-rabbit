# Lista de Compras — Microsserviços (Node.js + Express + NoSQL JSON)

Sistema distribuído para **gerenciamento de listas de compras** com **arquitetura de microsserviços**, **API Gateway**, **Service Discovery** baseado em arquivo, **JWT** e **bancos NoSQL** independentes (arquivos JSON).

## Arquitetura
**Serviços**
- **User Service (3001)** — autenticação (JWT) e gerenciamento de usuários
- **Item Service (3002)** — catálogo de itens/produtos (com *seed* de 20 itens)
- **List Service (3003)** — listas de compras (CRUD, itens da lista, resumo)
- **API Gateway (3000)** — ponto único de entrada, roteamento, *circuit breaker* e *health checks*

**Service Registry** (arquivo `services.registry.json` na raiz):
- Registro automático na inicialização (cada serviço chama `autoRegister`)
- *Heartbeats* a cada 30s e *cleanup* no encerramento
- Descoberta por nome com round-robin simples

### Diagrama (simplificado)
```text
Client → API Gateway:3000
          ├─ /api/auth/*  → User Service:3001
          ├─ /api/users/* → User Service:3001 (JWT)
          ├─ /api/items/* → Item Service:3002
          └─ /api/lists/* → List Service:3003 (JWT)

List Service → consulta Item Service para detalhes de item ao adicionar na lista
```

---

## Requisitos
- **Node.js 18+**
- Sem banco externo: tudo em **arquivos JSON**

## Instalação
```bash
npm install
```

## Execução
Em **quatro terminais** separados (ou use `start:all`):
```bash
npm run start:user     # porta 3001
npm run start:item     # porta 3002
npm run start:list     # porta 3003
npm run start:gateway  # porta 3000
```
Ou:
```bash
npm run start:all
```

> Dica: defina `JWT_SECRET` para trocar o segredo do JWT (opcional).

---

## Endpoints Principais (resumo)

### User Service (3001)
- `POST /auth/register` — cria usuário (email/username únicos, senha com bcrypt)
- `POST /auth/login` — login via `identifier` (email ou username) + `password`
- `GET /users/:id` — **JWT** obrigatório (somente o próprio usuário)
- `PUT /users/:id` — **JWT** obrigatório (atualiza perfil e preferences)

**Schema do Usuário**
```json
{
  "id": "uuid",
  "email": "string",
  "username": "string",
  "password": "hash",
  "firstName": "string",
  "lastName": "string",
  "preferences": { "defaultStore": "string", "currency": "string" },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### Item Service (3002)
- `GET /items?category=&name=` — lista itens com filtros
- `GET /items/:id` — busca um item
- `POST /items` — **JWT** obrigatório (cria item)
- `PUT /items/:id` — **JWT** obrigatório (atualiza item)
- `GET /categories` — lista categorias
- `GET /search?q=` — busca por nome/brand

**Seed**: 20 itens distribuídos em **Alimentos, Limpeza, Higiene, Bebidas, Padaria**  
Arquivo: `services/item-service/data/items.json`

**Schema do Item**
```json
{
  "id": "uuid",
  "name": "string",
  "category": "string",
  "brand": "string",
  "unit": "string",
  "averagePrice": "number",
  "barcode": "string",
  "description": "string",
  "active": "boolean",
  "createdAt": "timestamp"
}
```

### List Service (3003) — **JWT**
- `POST /lists` — cria lista
- `GET /lists` — lista todas do usuário
- `GET /lists/:id` — busca lista por id
- `PUT /lists/:id` — atualiza (nome/descrição/status)
- `DELETE /lists/:id` — remove
- `POST /lists/:id/items` — adiciona item (consulta ao Item Service)
- `PUT /lists/:id/items/:itemId` — atualiza item na lista
- `DELETE /lists/:id/items/:itemId` — remove item da lista
- `GET /lists/:id/summary` — resumo (total itens, comprados, valor estimado)

**Regra**: usuário só vê suas próprias listas.  
**Resumo**: calculado automaticamente (quantidade × preço estimado).

**Schema da Lista**
```json
{
  "id": "uuid",
  "userId": "string",
  "name": "string",
  "description": "string",
  "status": "active|completed|archived",
  "items": [
    {
      "itemId": "string",
      "itemName": "string",
      "quantity": "number",
      "unit": "string",
      "estimatedPrice": "number",
      "purchased": "boolean",
      "notes": "string",
      "addedAt": "timestamp"
    }
  ],
  "summary": {
    "totalItems": "number",
    "purchasedItems": "number",
    "estimatedTotal": "number"
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### API Gateway (3000)
- Roteamento:
  - `/api/auth/*` → User Service
  - `/api/users/*` → User Service
  - `/api/items/*` → Item Service
  - `/api/lists/*` → List Service
- Agregados:
  - `GET /api/dashboard` — estatísticas do usuário (JWT)
  - `GET /api/search?q=` — busca global (itens + listas do usuário autenticado)
  - `GET /health` — status dos serviços registrados
  - `GET /registry` — serviços no registry

**Circuit Breaker**: 3 falhas consecutivas abrem o circuito por 30s por serviço.  
**Logs**: todas as requisições logadas com `morgan` nos serviços e no gateway.

---

## Fluxo de Demonstração (client-demo.js)
1. Registro de usuário
2. Login (token JWT)
3. Busca de itens (categoria Alimentos)
4. Criação de lista
5. Adição de item à lista
6. Dashboard agregado e busca global

**Como rodar a demo** (com todos os serviços em execução):
```bash
node client-demo.js
```

---

## Bancos NoSQL (JSON)
- `data/users.json` (User Service) — criado automaticamente
- `services/item-service/data/items.json` (Item Service) — **já populado com 20 itens**
- `data/lists.json` (List Service) — criado automaticamente

---

## Variáveis de Ambiente
- `JWT_SECRET` — segredo do JWT (opcional; padrão `dev-secret`)
- `SERVICE_REGISTRY_FILE` — caminho do arquivo de registry (opcional)

---

## Entregáveis (checklist)
- ✅ 4 serviços funcionais (User, Item, List, Gateway)
- ✅ Service Registry implementado (arquivo + heartbeat + discover)
- ✅ Bancos NoSQL com dados de exemplo (items seed)
- ✅ Scripts `package.json` para execução (`start:*` e `start:all`)

---

## Observações
- O projeto não exige nenhum banco externo (Mongo/Redis). Tudo roda em arquivo JSON.
- Para testes com Postman/Insomnia, use as rotas via **Gateway** (`http://localhost:3000/api/...`).
- O List Service consulta o Item Service automaticamente ao adicionar itens.
