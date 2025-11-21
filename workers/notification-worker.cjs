// workers/notification-worker.cjs
const { getChannel } = require("../shared/rabbit.cjs");

async function startNotificationWorker() {
  try {
    console.log("📬 Notification Worker iniciando...");

    const channel = await getChannel();

    const exchange = "shopping_events";
    const queue = "q.notifications";
    const routingKey = "list.checkout.#";

    await channel.assertExchange(exchange, "topic", { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, routingKey);

    console.log(
      `📬 Notification Worker ouvindo: exchange='${exchange}', queue='${queue}', rk='${routingKey}'`
    );

    channel.consume(
      queue,
      (msg) => {
        if (!msg) return;

        const content = msg.content.toString();
        console.log("📩 Mensagem recebida (notification):", content);

        try {
          const event = JSON.parse(content);
          const listId = event.listId || event.id || "sem-id";
          const email =
            event.userEmail || event.email || "email-desconhecido";

          console.log(
            `✉️  Enviando comprovante da lista ${listId} para o usuário ${email}`
          );
        } catch (err) {
          console.error("❌ Erro ao processar mensagem:", err);
        } finally {
          channel.ack(msg);
        }
      },
      { noAck: false }
    );

    console.log("✅ Notification Worker pronto, aguardando mensagens...");
  } catch (err) {
    console.error("❌ Erro ao iniciar Notification Worker:", err);
    process.exit(1);
  }
}

startNotificationWorker();
