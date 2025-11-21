// shared/rabbit.cjs
const amqp = require("amqplib");

let connection = null;
let channel = null;

async function getChannel() {
  // só pra ter certeza que está sendo chamado:
  console.log("🔁 getChannel() foi chamado!");

  if (channel) {
    return channel;
  }

  const url = process.env.RABBITMQ_URL || "amqp://localhost";

  console.log("🔌 Conectando no RabbitMQ em", url);

  connection = await amqp.connect(url);
  channel = await connection.createChannel();

  console.log("✅ Canal RabbitMQ criado");

  // Encerrar com CTRL+C
  process.on("SIGINT", async () => {
    console.log("\n⏹ Encerrando conexão com RabbitMQ...");
    try {
      await channel.close();
      await connection.close();
    } catch (e) {
      // ignora erros de close
    }
    process.exit(0);
  });

  return channel;
}

// 👇 ESSA LINHA É A MAIS IMPORTANTE
module.exports = {
  getChannel,
};
