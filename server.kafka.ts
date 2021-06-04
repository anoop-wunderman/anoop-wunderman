import fetch from 'node-fetch';
import * as cron from 'node-cron';

import { producerRun } from './kafka';

const customFetch = (url: string) => fetch(url).then((res: any) => res.json());

// get API url
type UrlTypes = 'crmDSR' | 'crmDL' | 'crmCD' | 'ishC' | '';
interface URLsParams {
  type: UrlTypes;
  id: string;
  custid: string;
}
const getURL = (urlData?: Partial<URLsParams>): string => {
  const params: URLsParams = {
    type: '',
    id: 'UAT_WARRANTY_TEST3',
    custid: '1000058448',
    ...urlData,
  };

  // username: AGENTINTERSHOP, password: Welcome2
  const prepend = `https://AGENTINTERSHOP:Welcome2@my303458.crm.ondemand.com/sap/c4c/odata`;
  let url = '';
  switch (params.type) {
    case 'crmDSR':
      url = `${prepend}/v1/c4codataapi/ServiceRequestCollection/?$count&$filter=BuyerPartyID%20eq%20%271000058448%27%20and%20SerialID%20eq%20%27${params.id}%27%20and%20ProductID%20eq%20%2710395496%27%20and%20(Function%20eq%20%27121%27%20or%20Function%20eq%20%27141%27)&$format=json`;
      break;
    case 'crmDL':
      url = `${prepend}/v1/c4codataapi/RegisteredProductCollection/?$filter=ID%20eq%20%27105721%27&$format=json`;
      break;
    case 'crmCD':
      url = `${prepend}/ana_businessanalytics_analytics.svc/RPZ3C57BB6A3573F4EBAF490FQueryResults?$top=50&$select=CIPOINT_ID,CLIFE_CYCLE_STATUS_CODE,TLIFE_CYCLE_STATUS_CODE,CMATR_INT_ID,CZIP_CODE,CREG_PROD_EXTERNAL_ID,CREG_PROD_ID,CREGION_CODE_CONTENT,CSTREET,CWARRANTY_END_DATE,CWARRANTY_UUID,CWARRANTY_START_DATE&$filter=(CREMOTE_OBJECT_ID%20eq%20%27${params.custid}%27)&$format=json`;
      break;
    case 'ishC':
      url = `${prepend}`;
      break;
    default:
      url = prepend;
  }
  return url;
};

const mergeEqpData = (data: any) => {
  return data[0].map((loc: any) => {
    const sr = data[1].filter((s: any) => s.cregprodid === loc.cregprodid && s.eqpType === 'IOT');
    return {
      [loc.cregprodid]: {
        address: loc,
        servicerequest: sr.length ? sr : null,
      },
    };
  });
};

// Mapper for location response
const locationDataMapper = (d: any, custid: string) => ({
  customerid: custid,
  cipointid: d.ID,
  cregprodid: d.SerialID,
  cmatrintid: d.ProductID,
  room: d.Room,
  floor: d.Floor,
  building: d.Building,
  house: d.House,
  street: d.Street,
  addressLine1: d.AddressLine1,
  city: d.City,
  district: d.District,
  county: d.County,
  state: d.State,
  stateText: d.StateText,
  country: d.Country,
  countryText: d.CountryText,
  postalCode: d.PostalCode,
});

// Mapper for Device Service Request
const deviceServiceRequestsMapper = (d: any) => ({
  cregprodid: d.SerialID,
  eqpType: 'IOT',
  cmatrintid: d.ProductID,
  id: d.ID,
  warrantyid: d.WarrantyID,
  warrantyfrom: d.WarrantyFrom,
  warrantyTo: d.WarrantyTo,
  name: d.Name,
  entityLastChangedOn: d.EntityLastChangedOn,
  requestCloseddatetimeContent: d.RequestCloseddatetimeContent,
});

// Get Location data from API
const fetchLocations = async (Ids: string[], custid: string) => {
  const resArr = await (Promise as any).allSettled(
    Ids.map(id =>
      customFetch(`${getURL()}/v1/c4codataapi/RegisteredProductCollection/?$filter=ID%20eq%20%27${id}%27&$format=json`)
    )
  );
  return resArr.map((res: any) =>
    res.status === 'fulfilled'
      ? locationDataMapper(res.value?.d?.results[0], custid)
      : `Response (rejected): ${res.reason}`
  );
};

// Get Service Request data from API
const fetchDeviceServiceRequests = async (ids: string[]) => {
  const resArr = await (Promise as any).allSettled(ids.map(id => customFetch(getURL({ type: 'crmDSR', id }))));

  return resArr.map((res: any, i: number) => {
    if (res.status === 'fulfilled') {
      const result = res.value?.d?.results[0];
      return !result
        ? {
            cregprodid: ids[i],
            eqpType: 'Non-IOT',
          }
        : deviceServiceRequestsMapper(result);
    } else {
      return `Response (rejected): ${res.reason}`;
    }
  });
};

// Standalone function to Fetching Customer Data including location and service request
const fetchCRMCustomerData = async (custid = '') => {
  // fetch main data
  const data = await customFetch(getURL({ type: 'crmCD', custid }));
  // Ids
  let [cipointIds, cregprodIds] = data.d?.results.reduce(
    (acc: any, nxt: any) => {
      acc[0].push(nxt.CIPOINT_ID);
      acc[1].push(nxt.CREG_PROD_ID);
      return acc;
    },
    [[], []]
  );

  // Locations
  const locations = await fetchLocations(cipointIds, custid);
  // Service Requests
  const serviceRequests = await fetchDeviceServiceRequests(cregprodIds);

  return { [custid]: [locations, serviceRequests] };
};

const getCustomerIds = async () => {
  const customers = await (Promise as any).allSettled([
    customFetch(
      'https://admin:!InterShop00!@pall-sit.intershop.cloud/INTERSHOP/rest/WFS/PALL-Site/PALLUS/bocustomers?Channel=PALL-PALLUS-Site&UserRole=APP_B2B_SUPERVISOR'
    ),
    customFetch(
      'https://admin:!InterShop00!@pall-sit.intershop.cloud/INTERSHOP/rest/WFS/PALL-Site/PALLDE/bocustomers?Channel=PALL-PALLDE-Site&UserRole=APP_B2B_SUPERVISOR'
    ),
  ]);
  const ids = [];
  customers.forEach(res => {
    if (res.status === 'fulfilled') {
      res.value.elements.forEach(ele => {
        ids.push(ele.attributes[0].value);
      });
    } else {
      ids.push(`Response (rejected): ${res.reason}`);
    }
  });
  return ids;
};

const fetchCustomerIds = async () => {
  const customerIds = await getCustomerIds();
  const resArr = await (Promise as any).allSettled(customerIds.map(id => fetchCRMCustomerData(id)));
  const combinedData = {};
  resArr.forEach(res => {
    if (res.status === 'fulfilled') {
      Object.keys(res.value).forEach(k => {
        combinedData[k] = mergeEqpData(res.value[k]);
      });
    } else {
      throw Error(`Response (rejected): ${res.reason}`);
    }
  });
  return combinedData;
};

const produceCRMDataSchedular = () => {
  cron.schedule('1 * * * *', () => {
    console.log('running a task every 1 minute');
    fetchCustomerIds()
      .then(data => {
        producerRun(data);
      })
      .catch(error => {
        console.log(error);
      });
  });
};

// run on first time
produceCRMDataSchedular();

export const produceCRMData = (_req?: any, res?: any) => {
  fetchCustomerIds()
    .then(data => {
      producerRun(data);
      if (res) {
        res.status(res.statusCode).send(data);
      }
    })
    .catch(error => {
      console.log(error);
      if (res) {
        res.status(res.statusCode).send(error);
      }
    });
};
