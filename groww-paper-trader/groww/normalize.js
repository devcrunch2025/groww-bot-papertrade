
module.exports.normalize = raw => {
  const c = JSON.parse(raw.replace(/([a-zA-Z]+)/g, '"$1"'));
  return {
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
    time: new Date().toLocaleTimeString()
  };
};
