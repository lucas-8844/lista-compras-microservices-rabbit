// workers/analytics-worker.cjs
const { getChannel } = require("../shared/rabbit.cjs");

async function startAnalyticsWorker() {
  try {
    console.log("📊 Analytics Worker iniciando...");

    const channel = await getChannel();

    const exchange = "shopping_events";
    const queue = "q.analytics";
    const routingKey = "list.checkout.#";

    await channel.assertExchange(exchange, "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, routingKey);

    console.log(
      `📊 Analytics Worker ouvindo: exchange='${exchange}', queue='${queue}', rk='${routingKey}'`
    );

    channel.consume(
      queue,
      (msg) => {
        if (!msg) return;

        const content = msg.content.toString();
        console.log("📩 Mensagem recebida (analytics):", content);

        try {
          const event = JSON.parse(content);
          const items = event.items || [];
          const total = items.reduce(
            (acc, item) => acc + (item.price || 0) * (item.quantity || 1),
            0
          );

          console.log(
            `📊 Atualizando dashboard: lista=${event.listId || event.id}, total=R$ ${total.toFixed(
              2
            )}`
          );
        } catch (err) {
          console.error("❌ Erro ao processar mensagem (analytics):", err);
        } finally {
          channel.ack(msg);
        }
      },
      { noAck: false }
    );

    console.log("✅ Analytics Worker pronto, aguardando mensagens...");
  } catch (err) {
    console.error("❌ Erro ao iniciar Analytics Worker:", err);
    process.exit(1);
  }
}

startAnalyticsWorker();
