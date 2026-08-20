import catalog from "./runwayCatalog.generated.json";
import type { RunwayCatalog } from "./types";

// Generated from OurAirports runway data. Run `npm run generate:runways` to refresh.
export const generatedRunways: RunwayCatalog = catalog as RunwayCatalog;
