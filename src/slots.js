// Slot definitions — each slot owns a display, a browser profile, and one user's ESPN account.
// userId is null until resolved from the DB at agent startup.
const SLOTS = [
  {
    id: 0,
    display: ":99",
    profileDir: ".puppeteer-profile-slot-0",
    username: process.env.SLOT0_USERNAME || null,
    userId: null,
    inUse: false,
  },
  {
    id: 1,
    display: ":100",
    profileDir: ".puppeteer-profile-slot-1",
    username: process.env.SLOT1_USERNAME || null,
    userId: null,
    inUse: false,
  },
];

module.exports = { SLOTS };
