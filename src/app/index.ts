import * as express from 'express';
import * as morgan from 'morgan';

import { notNil, flatten, distanceBetween, haversine } from '../util';
import { Airport, Route, loadAirportData, loadRouteData } from '../data';

interface Node {
  airport: Airport;
  distanceFromSource: number;
  previousNode?: Node;
}

export async function createApp() {
  const app = express();

  const airports = await loadAirportData();
  const routes = await loadRouteData();
  const airportsByCode = new Map<string, Airport>(
    flatten(airports.map((airport) => [
      airport.iata !== null ? [airport.iata.toLowerCase(), airport] as const : null,
      airport.icao !== null ? [airport.icao.toLowerCase(), airport] as const : null,
    ].filter(notNil)))
  );

  app.use(morgan('tiny'));

  app.get('/health', (_, res) => res.send('OK'));
  app.get('/airports/:code', (req, res) => {
    const code = req.params['code'];
    if (code === undefined) {
      return res.status(400).send('Must provide airport code');
    }

    const airport = airportsByCode.get(code.toLowerCase());
    if (airport === undefined) {
      return res.status(404).send('No such airport, please provide a valid IATA/ICAO code');
    }

    return res.status(200).send(airport);
  });

  app.get('/routes-test/:source', (req, res) => {
    const source = req.params['source'];
    
    if (source === undefined) {
      return res.status(400).send('Must provide source airport');
    }
  
    const sourceAirport = airportsByCode.get(source.toLowerCase());

    const sourceRoutes = routes.filter((route) => route.source.id === sourceAirport.id);
    return res.status(200).send(sourceRoutes);
  })

  app.get('/routes/:source/:destination', (req, res) => {
    const source = req.params['source'];
    const destination = req.params['destination'];
    const maxStops = 3;
  
    if (source === undefined || destination === undefined) {
      return res.status(400).send('Must provide source and destination airports');
    }
  
    const sourceAirport = airportsByCode.get(source.toLowerCase());
    const destinationAirport = airportsByCode.get(destination.toLowerCase());
    if (sourceAirport === undefined || destinationAirport === undefined) {
      return res.status(404).send('No such airport, please provide a valid IATA/ICAO codes');
    }
    
    const findShortestRoute = (sourceAirport: Airport, destinationAirport: Airport, maxDistance: number): Route[] => {
      const nodes = airports.map((airport) => ({
        airport,
        distanceFromSource: airport.id === sourceAirport.id ? 0 : Infinity,
        previousNode: null,
      }));
      const visitedNodes: Node[] = [];
    
      while (nodes.length > 0) {
        // Find node with smallest distance from source
        const currentNode = nodes.reduce((minNode, node) => node.distanceFromSource < minNode.distanceFromSource ? node : minNode);
    
        // Check if destination airport has been reached
        if (currentNode.airport.id === destinationAirport.id) {
          const route: Route[] = [];
          let prevNode = currentNode;
          while (prevNode.previousNode !== null) {
            const prevAirport = prevNode.previousNode.airport;
            const currAirport = prevNode.airport;
            const currDistance = prevNode.distanceFromSource - prevNode.previousNode.distanceFromSource;
            const prevNodeRoute = routes.find((r) => r.source.id === prevAirport.id && r.destination.id === currAirport.id);
            if (!prevNodeRoute) {
              throw new Error(`Route not found from ${prevAirport.id} to ${currAirport.id}`);
            }
            route.unshift(prevNodeRoute);
            prevNode = prevNode.previousNode;
          }
          return route;
        }
    
        // Explore adjacent nodes
        nodes.splice(nodes.indexOf(currentNode), 1);
        visitedNodes.push(currentNode);
        for (const route of routes) {
          if (route.source.id === currentNode.airport.id) {
            const adjacentAirport = route.destination;
            let adjacentNode = nodes.find((node) => node.airport.id === adjacentAirport.id);
            if (!adjacentNode) {
              // Add new node for adjacent airport
              const newAdjacentNode = { airport: adjacentAirport, distanceFromSource: Infinity, previousNode: null };
              nodes.push(newAdjacentNode);
              if (currentNode.distanceFromSource + route.distance < maxDistance) { // check maximum distance
                adjacentNode = newAdjacentNode;
              } else {
                continue; // skip exploring this adjacent node
              }
            }
    
            const newDistanceFromSource = currentNode.distanceFromSource + route.distance;
            if (newDistanceFromSource < adjacentNode.distanceFromSource) {
              adjacentNode.distanceFromSource = newDistanceFromSource;
              adjacentNode.previousNode = currentNode;
            }
          }
        }
      }
    
      throw new Error(`No route found from ${sourceAirport.id} to ${destinationAirport.id}`);
    };

    const shortestRoute = findShortestRoute(sourceAirport, destinationAirport, maxStops);
    const distance = shortestRoute.reduce((sum, route) => sum + route.distance, 0);
    const hops = shortestRoute.map((route) => route.source.iata);
    hops.push(shortestRoute[shortestRoute.length - 1].destination.iata);
  
    return res.status(200).send({
      source: sourceAirport.iata || sourceAirport.icao,
      destination: destinationAirport.iata || destinationAirport.icao,
      distance: distance,
      hops: hops,
    });
  });

  return app;
}
