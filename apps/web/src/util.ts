let _id = 0;
export const uid = (p = "id"): string =>
  `${p}_${(++_id).toString(36)}${Date.now().toString(36).slice(-3)}`;
