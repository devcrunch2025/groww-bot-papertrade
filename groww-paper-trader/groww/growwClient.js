
const axios = require("axios");

const URL = "https://api.groww.in/v1/live-data/ohlc";

module.exports.fetchOHLC = async function (symbols) {
  const res = await axios.get(URL, {
    params: {
      segment: "CASH",
      exchange_symbols: symbols.join(",")
    },
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${process.env.GROWW_TOKEN}`,
      "X-API-VERSION": "1.0"
    }
  });
  return res.data.payload;
};
