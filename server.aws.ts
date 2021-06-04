import { S3Client, ListObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import * as moment from 'moment';
import { getCollection } from './server.mongo';

process.env.AWS_ACCESS_KEY_ID = 'AKIAYLQLZHE6ECYIKGYE';
process.env.AWS_SECRET_ACCESS_KEY = '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';

const awsConfig = {
  bucket: 'pall-iot-operational-report-sit',
  delimiter: '/',
  region: 'us-east-2',
  s3Object: new S3Client({ region: 'us-east-2' }),
};

interface BucketParams {
  Bucket: string;
  Delimiter: string;
  Prefix?: string;
  Marker?: string;
}

interface PDFResponse {
  Key: string;
  LastModified: Date;
  ETag: string;
  Size: number;
  StorageClass: string;
  Owner: {
    DisplayName: string;
    ID: string;
  };
}

const extractDateFromString = (s: string) => s.match(/\d{4}-\d{2}-\d{2}/)?.[0];

const getPDFLink = async (s3, bucket, key, region) => {
  const params = {
    Bucket: bucket,
    Key: key,
    Region: region,
  };

  try {
    const command = new GetObjectCommand(params);
    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: 3600,
    });
    return signedUrl;
  } catch (err) {
    console.log('Error creating presigned URL', err);
  }
};

const getFliesFromAWS = async (Prefix: string) => {
  let result = [];
  let truncated = true;
  let pageMarker: any;
  let bucketParams: BucketParams = {
    Bucket: awsConfig.bucket,
    Delimiter: awsConfig.delimiter,
  };
  while (truncated) {
    try {
      const response = await awsConfig.s3Object.send(new ListObjectsCommand({ ...bucketParams, Prefix }));
      result = result.concat(response.Contents ?? []);

      truncated = response.IsTruncated;
      if (truncated) {
        pageMarker = response.Contents.slice(-1)[0].Key;
        bucketParams = { ...bucketParams, Marker: pageMarker };
      }
      // At end of the list, response.truncated is false and our function exits the while loop.
    } catch (err) {
      console.log('Error', err);
      truncated = false;
    }
  }
  return result;
};

const fetchPDFs = (ids: string, cb: any) => {
  const machines = ids.split(',');
  getCollection('sensors', async (data: any[]) => {
    console.log(data, machines);
    let prefixArr = data.reduce((acc, nxt) => {
      if (nxt.site_id && nxt.company_id && machines.includes(nxt.machine_id)) {
        acc = [...acc, `${nxt.company_id}/${nxt.site_id}/operationreport/`];
      }
      return acc;
    }, []);
    // While loop that runs until response.truncated is false
    const response = await (Promise as any).allSettled(prefixArr.map((prfx: string) => getFliesFromAWS(prfx)));
    let files = [];
    response.forEach(res => {
      if (res.status === 'fulfilled') {
        if (res.value.length) {
          files = files.concat(res.value);
        }
      } else {
        console.log(`Error in AWS Files (rejected): ${res.reason}`);
      }
    });
    cb(files);
  });
};

// Create the parameters for the bucket
export const getPDFs = (ids, sDate: string, eData: string, cb: (d: any) => void) => {
  fetchPDFs(ids, (res: any) => {
    const filteredData = res
      .filter(d => {
        const date = extractDateFromString(d.Key);
        if (date) {
          return moment(date).isBetween(sDate, eData);
        }
      })
      .map(file => {
        const name = file.Key.split('/');
        return {
          key: file.Key,
          name: name[name.length - 1],
          date: moment(extractDateFromString(file.Key)).format('MM/DD/YYYY'),
        };
      });
    cb(filteredData);
  });
};

export const getDownloadLink = async (key: string, cb: (d: any) => void) => {
  const link = await getPDFLink(awsConfig.s3Object, awsConfig.bucket, key, awsConfig.region);
  cb(link);
};
