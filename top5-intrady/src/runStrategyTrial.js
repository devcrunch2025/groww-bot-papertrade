const { runHistoryTrialForDate, applyStrategyPreset } = require('./strategyEngine');

(async () => {
  try {
    const dateArg = process.argv[2];
    const strategy = process.argv[3] || 'S3';
    console.log(`Running history trial for strategy ${strategy} ${dateArg ? `on ${dateArg}` : 'for today'}`);
    // apply the preset so STRATEGY_CONFIG is adjusted
    applyStrategyPreset(strategy);
    const result = await runHistoryTrialForDate(dateArg);

    console.log('\n=== STRATEGY HISTORY TRIAL ===');
    console.log(`Strategy: ${strategy}`);
    console.log(`Date: ${result.date}`);
    console.log(`Top symbols: ${result.selectedSymbols.map((item) => item.symbol).join(', ')}`);
    console.log(`Total trades: ${result.summary.totalTrades}`);
    console.log(`Realized P&L: ${result.summary.totalRealizedPnl}`);
    console.log(`Unrealized P&L: ${result.summary.totalUnrealizedPnl}`);
    console.log(`Total P&L: ${result.summary.totalPnl}`);

    console.log('\nPer Symbol:');
    result.perSymbol.forEach((item) => {
      console.log(
        `${item.symbol} | Realized: ${item.realizedPnl} | Unrealized: ${item.unrealizedPnl} | Total: ${item.totalPnl} | Trades: ${item.trades.length}`
      );
    });

    console.log('\nLast 20 Trades:');
    result.trades.slice(-20).forEach((trade) => {
      const pnl = typeof trade.pnl === 'number' ? ` | P&L: ${trade.pnl}` : '';
      console.log(`${new Date(trade.time).toLocaleString()} | ${trade.action} | ${trade.symbol} | ${trade.price} | Units: ${trade.units}${pnl}`);
    });
  } catch (error) {
    console.error('Trial failed:', error && error.message ? error.message : String(error));
    process.exit(1);
  }
})();
