// shared/rabbit-producer.js
import amqp from 'amqplib';

let connection = null;
let channel = null;

export async function getChannel() {
  if (channel) return channel;

  const url = process.env.RABBITMQ_URL || 'amqp://localhost';
  console.log('🔌 [producer] Conectando no RabbitMQ em', url);

  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  console.log('✅ [producer] Canal RabbitMQ criado');
  return channel;
}

export async function publishEvent(exchange, routingKey, payload) {
  const ch = await getChannel();
  await ch.assertExchange(exchange, 'topic', { durable: true });

  const buffer = Buffer.from(JSON.stringify(payload));
  ch.publish(exchange, routingKey, buffer, {
    contentType: 'application/json',
    persistent: true,
  });

  console.log(
    `📤 Evento publicado: exchange=${exchange}, rk=${routingKey}, payload=${JSON.stringify(
      payload
    )}`
  );
}
