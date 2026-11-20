
import { createContext, useContext } from "react";

const RouteCatalogContext = createContext([]);

export function RouteCatalogProvider({ capabilities, children }) {
  return (
    <RouteCatalogContext.Provider value={capabilities}>
      {children}
    </RouteCatalogContext.Provider>
  );
}

export function useRouteCatalog() {
  return useContext(RouteCatalogContext);
}
