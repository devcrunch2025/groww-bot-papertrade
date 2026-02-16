
module.exports.check = candle => {
  if (candle.close > candle.open) {
    return {
      entry: candle.close,
      exit: candle.close + 5,
      score: 80
    };
  }
  return null;
};
