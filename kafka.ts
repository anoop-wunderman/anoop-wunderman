const { Kafka, logLevel } = require('kafkajs');
const { CompressionTypes, CompressionCodecs } = require('kafkajs');
const SnappyCodec = require('kafkajs-snappy');
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;

const kafka = new Kafka({
  logLevel: logLevel.INFO,
  brokers: ['pkc-lgwgm.eastus2.azure.confluent.cloud:9092'],
  clientId: 'iot-pall',
  ssl: {
    rejectUnauthorized: false,
  },
  sasl: {
    mechanism: 'plain',
    username: 'DR4BZKP6TQ6AAZJY',
    password: 'l+1BtX3AML8VOaT7kCsmmACrBy8LNO8NTtnyy2HWkPDY/snFe3AgjJKzAVYkh+gB',
  },
});

const admin = kafka.admin();
const CRM_TOPIC = 'CRM';
const SENSOR_TOPIC = 'INT_OENOFLOW_EGRESS_SENSORS';
// const EQUIP_TEMPLATE_TOPIC = 'INT_OENOFLOW_EGRESS_MASTER_TEMPLATE';
// let templateMap = new Map();
let devices: any[] = [];
const producer = kafka.producer();

const produceTopic = () => {
  producer.send({
    topic: CRM_TOPIC,
    messages: devices,
  });
};

const consumer = kafka.consumer({ groupId: require('os').hostname() + '-equip-sensors-group' });
const consumeTopic = async (socket, offset) => {
  await consumer.run({
    eachMessage: async ({ message }) => {
      // eachMessage: async ({ topic, partition, message }) => {
      // const prefix = `${topic}[${partition} | ${message.offset} | ${message.key} ] / ${message.timestamp}`;
      // console.log('\x1b[34m%s\x1b[0m', `- ${prefix} ${message.key} # ${message.value}`);
      socket.broadcast.emit(`sensor-${message.key}`, `${message.value}`);
      socket.emit(`sensor-${message.key}`, `${message.value}`);
    },
  });
  consumer.seek({ topic: SENSOR_TOPIC, partition: 0, offset });
};

//Code for Master Template data from Kafka.
// const CONSUMER_EQUIP_TEMPLATE_TOPIC = kafka.consumer({ groupId: require('os').hostname() + '-template-equip-group' });
// const PROCESS_MASTER_TEMPLATE = async socket => {
//   await CONSUMER_EQUIP_TEMPLATE_TOPIC.run({
//     autoCommit: false,
//     eachMessage: async ({ topic, partition, message }) => {
//       const prefix = `${topic}[${partition} | ${message.offset}] | ${message.key} / ${message.timestamp}`;
//       console.log('\x1b[32m%s\x1b[0m', `- ${prefix} ${message.value} `);
//       // filter the messages from specific current date and unique key and PUSH to an Map and use the map on socket
//       // let msgDate = new Date(Number(message.timestamp));
//       // let currentDate = new Date();
//       templateMap.set(`${message.key}`, `${message.value}`);
//       // if (msgDate.toDateString() == currentDate.toDateString()) {
//       //   }
//     },
//   });

//   templateMap.forEach(function (value, key) {
//     console.log(key + ' <===> ' + value);
//     socket.broadcast.emit(key, value);
//     socket.emit(key, value);
//   });
// };

export const producerRun = async (crmData: any) => {
  // console.log(crmData);

  let key: keyof typeof crmData = Object.keys(crmData)[0];
  if (key && crmData[key].length > 0) {
    crmData[key].forEach(device => {
      var subkey = Object.keys(device)[0];
      subkey &&
        devices.push({
          key: subkey,
          value: JSON.stringify(device[subkey]),
        });
    });
  }
  if (devices.length > 0) {
    produceTopic();
  }
};

let socketIo: any;

export default () => socketIo;

export const socketRun = async (ssl: any) => {
  await producer.connect();

  await consumer.connect();
  await consumer.subscribe({ topic: SENSOR_TOPIC, fromBeginning: true });

  // await CONSUMER_EQUIP_TEMPLATE_TOPIC.connect();
  // await CONSUMER_EQUIP_TEMPLATE_TOPIC.subscribe({ topic: EQUIP_TEMPLATE_TOPIC, fromBeginning: true });

  const io = require('socket.io')(ssl, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    autoConnect: false,
  });

  io.on('connection', (socket: any) => {
    socketIo = socket;
    admin.fetchTopicOffsets(SENSOR_TOPIC).then(function (data: any) {
      let lastOffset = data[0].offset - 1 + '';
      // console.log('offset from topic ' + SENSOR_TOPIC + ' =>> ' + lastOffset);
      //USE THE LATEST OFFSET and VALUE to REDUX and USE it on first load of WIDGET.
      consumeTopic(socket, lastOffset);
    });
    // PROCESS_MASTER_TEMPLATE(socket).catch(e =>
    //   console.error(`[example/CONSUMER_EQUIP_TEMPLATE_TOPIC] ${e.message}`, e)
    // );
  });
};
