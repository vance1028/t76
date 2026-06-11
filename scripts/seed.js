'use strict';

/** 手动重置并写入种子数据：npm run seed */
const { waitForDb, close } = require('../src/db');
const store = require('../src/data/store');

(async () => {
  try {
    await waitForDb();
    await store.seed();
    // eslint-disable-next-line no-console
    console.log('种子数据已重置完成');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('种子数据写入失败：', err);
    process.exitCode = 1;
  } finally {
    await close();
  }
})();
