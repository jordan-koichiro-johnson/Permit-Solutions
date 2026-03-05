const PLANS = {
  free:     { label: 'Free',     userLimit: 1,    canCheck: false, canImport: false, price: 0   },
  starter:  { label: 'Starter',  userLimit: 10,   canCheck: true,  canImport: true,  price: 20  },
  business: { label: 'Business', userLimit: null,  canCheck: true,  canImport: true,  price: 100 },
};

const STATE_ADDON_PRICE = 5;

module.exports = { PLANS, STATE_ADDON_PRICE };
