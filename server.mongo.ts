import { upperFirst } from 'lodash';
import { MongoClient } from 'mongodb';
const assert = require('assert');
import socketIo from './kafka';
const moment = require('moment');
const opCAndVXaxis = {};
let opEByWXaxis;
let mangoConnected: boolean = false;

type DataPoints = '1W' | '2W' | '1M' | '3M' | '1Y';
const calculateDate = (type: DataPoints, from: any) => {
  switch (type) {
    case '1W':
      return from.subtract(1, 'weeks').day('Monday');
    case '2W':
      return from.subtract(2, 'weeks').day('Monday');
    case '1M':
      return from.subtract(1, 'months');
    case '3M':
      return from.subtract(1, 'quarter').startOf('quarter');
    case '1Y':
      return from.subtract(1, 'years');
  }
};

const getBoundaries = (type: DataPoints, labelFormat: string, thresHold = 7): string[] => {
  let startingPoint = moment();
  switch (type) {
    case '1W':
      startingPoint = moment().day('Monday');
      break;
    case '2W':
      startingPoint = moment().subtract(1, 'weeks').day('Monday');
      break;
    case '3M':
      startingPoint = moment().startOf('quarter');
      break;
  }

  const boundries = [startingPoint.format('YYYY-MM-DD')];
  const names = [startingPoint.format(labelFormat)];
  for (let count = 0; count < thresHold; count++) {
    startingPoint = calculateDate(type, startingPoint);
    boundries.push(startingPoint.format('YYYY-MM-DD'));
    names.push(startingPoint.format(labelFormat));
  }
  opCAndVXaxis[type] = names.reverse();
  return boundries;
};

const getBucket = (boundary: string[], defaultType: string) => [
  {
    $bucket: {
      groupBy: '$period',
      boundaries: boundary.sort(),
      default: defaultType,
      output: {
        Electricity: { $sum: '$electricity' },
        Water: { $sum: '$water' },
        Chemicals: { $sum: '$chems' },
        'Wine Loss': { $sum: '$wineLoss' },
        Volume: { $sum: '$volume' },
        'Normalized Cost': {
          $sum: '$NormalizedCost',
        },
        count: { $sum: 1 },
      },
    },
  },
];

const opCostAndVolumeChartQuery = (machineIds: string[] = []) => {
  const weekBoundaries = getBoundaries('1W', 'MMM DD');
  const biWeeklyBoundaries = getBoundaries('2W', 'MMM DD');
  const monthBoundaries = getBoundaries('1M', 'MMM YYYY');
  const qtrBoundaries = getBoundaries('3M', 'MMM YYYY');
  const yearBoundaries = getBoundaries('1Y', 'YYYY');
  //Pipeline
  return [
    {
      $match: {
        machine_id: { $in: machineIds },
      },
    },
    {
      $addFields: {
        OperatingCostTotal: {
          $add: ['$electricity', '$water', '$chems', '$wineLoss'],
        },
      },
    },
    {
      $addFields: {
        NormalizedCost: {
          $cond: [{ $eq: ['$volume', 0] }, 'N/A', { $divide: ['$OperatingCostTotal', '$volume'] }],
        },
      },
    },
    {
      $facet: {
        '1W': getBucket(weekBoundaries, 'Above 1W'),
        '2W': getBucket(biWeeklyBoundaries, 'Above 2W'),
        '1M': getBucket(monthBoundaries, 'Above 45'),
        '3M': getBucket(qtrBoundaries, 'Other'),
        '1Y': getBucket(yearBoundaries, 'later 1Y'),
      },
    },
    {
      $addFields: {
        maxWeeklyElectricityCost: {
          $max: '$1W.Electricity',
        },
        maxWeeklyChemicalCost: {
          $max: '$1W.Chemicals',
        },
        maxWeeklyWaterCost: {
          $max: '$1W.Water',
        },
        maxWeeklyWineLosssCost: {
          $max: '$1W.Wine Loss',
        },
        maxBiWeeklyElectricityCost: {
          $max: '$2W.Electricity',
        },
        maxBiWeeklyChemicalCost: {
          $max: '$2W.Chemicals',
        },
        maxBiWeeklyWaterCost: {
          $max: '$2W.Water',
        },
        maxBiWeeklyWineLosssCost: {
          $max: '$2W.Wine Loss',
        },
        maxMonthlyElectricityCost: {
          $max: '$1M.Electricity',
        },
        maxMonthlyChemicalCost: {
          $max: '$1M.Chemicals',
        },
        maxMonthlyWaterCost: {
          $max: '$1M.Water',
        },
        maxMonthlyWineLosssCost: {
          $max: '$1M.Wine Loss',
        },
        maxQtrlyElectricityCost: {
          $max: '$3M.Electricity',
        },
        maxQtrlyChemicalCost: {
          $max: '$3M.Chemicals',
        },
        maxQtrlyWaterCost: {
          $max: '$3M.Water',
        },
        maxQtrlyWineLosssCost: {
          $max: '$3M.Wine Loss',
        },
        maxYrlyElectricityCost: {
          $max: '$1Y.Electricity',
        },
        maxYrlyChemicalCost: {
          $max: '$1Y.Chemicals',
        },
        maxYrlyWaterCost: {
          $max: '$1Y.Water',
        },
        maxYrlyWineLosssCost: {
          $max: '$1Y.Wine Loss',
        },
      },
    },
    {
      $addFields: {
        maxVolume: {
          '1W': { $max: '$1W.Volume' },
          '2W': { $max: '$2W.Volume' },
          '1M': { $max: '$1M.Volume' },
          '3M': { $max: '$3M.Volume' },
          '1Y': { $max: '$1Y.Volume' },
        },
        maxCost: {
          '1W': {
            $add: [
              '$maxWeeklyElectricityCost',
              '$maxWeeklyChemicalCost',
              '$maxWeeklyWaterCost',
              '$maxWeeklyWineLosssCost',
            ],
          },
          '2W': {
            $add: [
              '$maxBiWeeklyElectricityCost',
              '$maxBiWeeklyChemicalCost',
              '$maxBiWeeklyWaterCost',
              '$maxBiWeeklyWineLosssCost',
            ],
          },
          '1M': {
            $add: [
              '$maxMonthlyElectricityCost',
              '$maxMonthlyChemicalCost',
              '$maxMonthlyWaterCost',
              '$maxMonthlyWineLosssCost',
            ],
          },
          '3M': {
            $add: ['$maxQtrlyElectricityCost', '$maxQtrlyChemicalCost', '$maxQtrlyWaterCost', '$maxQtrlyWineLosssCost'],
          },
          '1Y': {
            $add: ['$maxYrlyElectricityCost', '$maxYrlyChemicalCost', '$maxYrlyWaterCost', '$maxYrlyWineLosssCost'],
          },
        },
      },
    },
    {
      $unset: [
        'maxWeeklyElectricityCost',
        'maxWeeklyChemicalCost',
        'maxWeeklyWaterCost',
        'maxWeeklyWineLosssCost',
        'maxBiWeeklyElectricityCost',
        'maxBiWeeklyChemicalCost',
        'maxBiWeeklyWaterCost',
        'maxBiWeeklyWineLosssCost',
        'maxMonthlyElectricityCost',
        'maxMonthlyChemicalCost',
        'maxMonthlyWaterCost',
        'maxMonthlyWineLosssCost',
        'maxQtrlyElectricityCost',
        'maxQtrlyChemicalCost',
        'maxQtrlyWaterCost',
        'maxQtrlyWineLosssCost',
        'maxYrlyElectricityCost',
        'maxYrlyChemicalCost',
        'maxYrlyWaterCost',
        'maxYrlyWineLosssCost',
      ],
    },
  ];
};

const opExpensesByWeekChartQuery = (machineIds: string[] = []) => {
  let currentWeek = moment().isoWeekday(1);
  let weekOfYear = currentWeek.week();
  let weekThreshold = moment().weeksInYear();
  let weekBoundaries = [currentWeek.format('YYYY-MM-DD')];
  let weekNames = [weekOfYear];
  for (let count = 0; count < weekThreshold; count++) {
    currentWeek = currentWeek.subtract(1, 'weeks').day('Monday');
    weekBoundaries.push(currentWeek.format('YYYY-MM-DD'));
    weekNames.push(currentWeek.week());
  }
  opEByWXaxis = weekNames.reverse();

  return [
    {
      $match: {
        machine_id: {
          $in: machineIds,
        },
      },
    },
    {
      $lookup: {
        from: 'operatingcost-dedup',
        let: {
          opex_period: '$period',
          opex_machineid: '$machine_id',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ['$machine_id', '$$opex_machineid'],
                  },
                  {
                    $eq: ['$period', '$$opex_period'],
                  },
                ],
              },
            },
          },
          {
            $project: {
              _id: '$period',
              machine_id: '$machine_id',
              volume: '$volume',
            },
          },
        ],
        as: 'opexvolume',
      },
    },
    {
      $unwind: {
        path: '$opexvolume',
      },
    },
    {
      $addFields: {
        volume: '$opexvolume.volume',
      },
    },
    {
      $unset: ['opexvolume'],
    },
    {
      $addFields: {
        OpexTotal: {
          $add: [
            '$autopilotWineLoss',
            '$autopilotElectricity',
            '$autopilotChems',
            '$autopilotWater',
            '$manualWineLoss',
            '$manualElectricity',
            '$manualChems',
            '$manualWater',
          ],
        },
      },
    },
    {
      $facet: {
        '1W': [
          {
            $bucket: {
              groupBy: '$period',
              boundaries: weekBoundaries.sort(),
              default: 'OutOfRange',
              output: {
                'OPEX Auto Wine': {
                  $sum: '$autopilotWineLoss',
                },
                'OPEX Auto Energy': {
                  $sum: '$autopilotElectricity',
                },
                'OPEX Auto Chemicals': {
                  $sum: '$autopilotChems',
                },
                'OPEX Auto Water': {
                  $sum: '$autopilotWater',
                },
                'OPEX Manual Wine': {
                  $sum: '$manualWineLoss',
                },
                'OPEX Manual Energy': {
                  $sum: '$manualElectricity',
                },
                'OPEX Manual Chemicals': {
                  $sum: '$manualChems',
                },
                'OPEX Manual Water': {
                  $sum: '$manualWater',
                },
                'OPEX Total': {
                  $sum: '$OpexTotal',
                },
                'Weekly Volume': {
                  $sum: '$volume',
                },
              },
            },
          },
        ],
      },
    },
    {
      $addFields: {
        maxOpexAutoWineCost: {
          $max: '$1W.OPEX Auto Wine',
        },
        maxOpexAutoEnergyCost: {
          $max: '$1W.OPEX Auto Energy',
        },
        maxOpexAutoChemicalCost: {
          $max: '$1W.OPEX Auto Chemicals',
        },
        maxOpexAutoWaterCost: {
          $max: '$1W.OPEX Auto Water',
        },
        maxOpexManualWineCost: {
          $max: '$1W.OPEX Manual Wine',
        },
        maxOpexManualEnergyCost: {
          $max: '$1W.OPEX Manual Energy',
        },
        maxOpexManualChemicalCost: {
          $max: '$1W.OPEX Manual Chemicals',
        },
        maxOpexManualWaterCost: {
          $max: '$1W.OPEX Manual Water',
        },
        maxOpexTotalCost: {
          $max: '$1W.OPEX Total',
        },
        maxWeeklyVolume: {
          $max: '$1W.Weekly Volume',
        },
      },
    },
    {
      $addFields: {
        maxCost: {
          $max: [
            '$maxOpexAutoWineCost',
            '$maxOpexAutoEnergyCost',
            '$maxOpexAutoChemicalCost',
            '$maxOpexAutoWaterCost',
            '$maxOpexManualWineCost',
            '$maxOpexManualEnergyCost',
            '$maxOpexManualChemicalCost',
            '$maxOpexManualWaterCost',
            '$maxOpexTotalCost',
          ],
        },
        maxVolume: {
          $max: '$maxWeeklyVolume',
        },
      },
    },
    {
      $unset: [
        'maxOpexAutoWineCost',
        'maxOpexAutoEnergyCost',
        'maxOpexAutoChemicalCost',
        'maxOpexAutoWaterCost',
        'maxOpexManualWineCost',
        'maxOpexManualEnergyCost',
        'maxOpexManualChemicalCost',
        'maxOpexManualWaterCost',
        'maxOpexTotalCost',
        'maxWeeklyVolume',
      ],
    },
  ];
};

const getNotification = (machineIds: string[] = [], notificationId?: string) => {
  let pipeline = notificationId
    ? {
        $match: { notification_id: notificationId },
      }
    : {
        $match: {
          machine_id: { $in: machineIds },
          eventTime: {
            $gte: new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      };

  return [
    pipeline,
    {
      $lookup: {
        from: 'localization',
        localField: 'event_id',
        foreignField: 'event_id',
        as: 'message',
      },
    },
    {
      $unwind: {
        path: '$message',
      },
    },
    {
      $project: {
        event_id: 1,
        company_id: 1,
        dismissable: 1,
        eventTime: 1,
        site_id: 1,
        machine_id: machineIds,
        notification_id: 1,
        type: 1,
        id: 1,
        dismissible: '$message.dismissible',
        category: '$message.category',
        alertType: '$message.alertType',
        title: '$message.en.title',
        desc: '$message.en.desc',
        ts: '$message.en.ts',
      },
    },
  ];
};

const client = new MongoClient(
  'mongodb+srv://iot:W7FIRFhzQCCeX8RP@palliot.f8mph.mongodb.net/oenoflow?retryWrites=true&w=majority'
);
client.connect(function (err) {
  if (err) {
    console.log('Connection Error: ', err);
    client.close();
  } else {
    console.log('Connected successfully to MongoDB');
    mangoConnected = true;
  }
});

let changeStream: any;

const watchChanges = (machineIds: string[]) => {
  let socket = socketIo();
  const db = client.db('oenoflow');
  const coll = db.collection('notification');
  if (changeStream) changeStream.close();
  changeStream = coll.watch([
    {
      $match: {
        operationType: {
          $in: ['insert'],
        },
        'fullDocument.machine_id': { $in: [machineIds] },
      },
    },
  ]);
  changeStream.on('change', document => {
    let notificationId = document.fullDocument.notification_id;
    coll
      .aggregate(getNotification([], notificationId))
      .toArray()
      .then(res => {
        if (res && res.length) socket.emit('on-notification', res[0]);
      });
  });
};

export const getCollection = (colName: string, callback, chartType?: 'op' | 'au' | 'nf', devices?: string[]) => {
  if (mangoConnected) {
    const db = client.db('oenoflow');
    const coll = db.collection(colName);
    if (chartType === 'op') {
      const bucket = opCostAndVolumeChartQuery(devices);
      coll
        .aggregate(bucket)
        .toArray()
        .then(res => {
          callback({ series: res[0], xAxis: opCAndVXaxis });
        });
    } else if (chartType === 'au') {
      const bucket = opExpensesByWeekChartQuery(devices);
      coll
        .aggregate(bucket)
        .toArray()
        .then(res => {
          callback({ series: res[0], xAxis: opEByWXaxis });
        });
    } else if (chartType === 'nf') {
      const bucket = getNotification(devices);
      coll
        .aggregate(bucket)
        .toArray()
        .then(res => {
          callback(res);
          watchChanges(devices);
        });
    } else {
      coll.find({}).toArray(function (err, results) {
        if (err) {
          console.log(`${colName} Data Error: ${err}`);
        }
        callback(
          results.map(res => {
            const d = { ...res };
            delete d._id;
            return d;
          })
        );
      });
    }
  }
};

export const getChartCollection = () => {};
