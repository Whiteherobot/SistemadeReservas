const CircuitBreaker = require('opossum');
const axios = require('axios');
const logger = require('./logger');

function createCircuitBreaker(fn, options = {}) {
  const defaultOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 3000,
    volumeThreshold: 2,
    name: 'default-breaker'
  };

  const config = { ...defaultOptions, ...options };
  const breaker = new CircuitBreaker(fn, config);

  breaker.on('open', () => {
    logger.warn(`Circuit breaker OPEN: ${config.name} - Too many failures detected`);
  });

  breaker.on('halfOpen', () => {
    logger.info(`Circuit breaker HALF-OPEN: ${config.name} - Testing recovery`);
  });

  breaker.on('close', () => {
    logger.info(`Circuit breaker CLOSED: ${config.name} - Service recovered`);
  });

  breaker.on('fallback', (result) => {
    logger.warn(`Fallback ACTIVATED: ${config.name} - Using alternative response`);
  });

  return breaker;
}

async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2,
    name = 'retry-operation'
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempt ${attempt + 1}/${maxRetries + 1}: ${name}`);
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.min(initialDelay * Math.pow(factor, attempt), maxDelay);
        logger.warn(`Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  
  logger.error(`All retries failed for: ${name}`);
  throw lastError;
}

class Bulkhead {
  constructor(maxConcurrent, name = 'bulkhead') {
    this.maxConcurrent = maxConcurrent;
    this.name = name;
    this.currentConcurrent = 0;
    this.queue = [];
  }

  async execute(fn) {
    if (this.currentConcurrent >= this.maxConcurrent) {
      logger.warn(`Bulkhead SATURATED: ${this.name} (${this.currentConcurrent}/${this.maxConcurrent}) - Queueing request`);
      
      return new Promise((resolve, reject) => {
        this.queue.push({ fn, resolve, reject });
      });
    }

    return this._execute(fn);
  }

  async _execute(fn) {
    this.currentConcurrent++;
    logger.info(`Bulkhead: ${this.name} - Resources: ${this.currentConcurrent}/${this.maxConcurrent}`);

    try {
      const result = await fn();
      return result;
    } finally {
      this.currentConcurrent--;
      this._processQueue();
    }
  }

  _processQueue() {
    if (this.queue.length > 0 && this.currentConcurrent < this.maxConcurrent) {
      const { fn, resolve, reject } = this.queue.shift();
      this._execute(fn).then(resolve).catch(reject);
    }
  }
}

function createResilientHttpClient(baseURL, options = {}) {
  const {
    timeout = 5000,
    retries = 3,
    breakerOptions = {}
  } = options;

  const client = axios.create({
    baseURL,
    timeout
  });

  const breakerName = `http-${baseURL}`;
  
  const breaker = createCircuitBreaker(
    async (config) => {
      return await retryWithBackoff(
        () => client.request(config),
        {
          maxRetries: retries,
          name: `${breakerName}-${config.method}-${config.url}`
        }
      );
    },
    {
      ...breakerOptions,
      name: breakerName
    }
  );

  return {
    async get(url, config = {}) {
      return breaker.fire({ method: 'get', url, ...config });
    },
    async post(url, data, config = {}) {
      return breaker.fire({ method: 'post', url, data, ...config });
    },
    async put(url, data, config = {}) {
      return breaker.fire({ method: 'put', url, data, ...config });
    },
    async delete(url, config = {}) {
      return breaker.fire({ method: 'delete', url, ...config });
    },
    breaker
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  createCircuitBreaker,
  retryWithBackoff,
  Bulkhead,
  createResilientHttpClient,
  sleep
};
