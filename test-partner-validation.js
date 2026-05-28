// Test script to demonstrate partner validation
import { loadPartnerRestaurants, loadPartnerActivities } from './src/services/catalog/catalog.service.js';

async function testPartnerMatching() {
  console.log('=== Testing Partner Data Matching ===\n');
  
  // Load NYC partners
  const restaurants = await loadPartnerRestaurants('New York City');
  const activities = await loadPartnerActivities('New York City');
  
  console.log('Available Restaurant Partners:');
  restaurants.forEach(r => {
    console.log(`  - ${r.name} (ID: ${r.id}) [${r.latitude}, ${r.longitude}]`);
  });
  
  console.log('\nAvailable Activity Partners:');
  activities.forEach(a => {
    console.log(`  - ${a.name} (ID: ${a.id}) [${a.latitude}, ${a.longitude}]`);
  });
  
  // Test matching scenarios
  console.log('\n=== Testing Matching Scenarios ===');
  
  // Scenario 1: Exact match by ID
  const testActivity1 = {
    id: "rest-nyc-2",
    name: "Joe's Pizza - Greenwich Village",
    provider: "Joe's Pizza - Greenwich Village",
    latitude: 40.7229, // AI modified coordinate
    longitude: -73.9972 // AI modified coordinate
  };
  
  console.log('\nTesting scenario 1 - Exact ID match:');
  console.log('AI Data:', testActivity1);
  
  const matchedRestaurant = restaurants.find(r => r.id === testActivity1.id);
  if (matchedRestaurant) {
    console.log('✅ Match found!');
    console.log('Authentic coords:', matchedRestaurant.latitude, matchedRestaurant.longitude);
    console.log('AI had wrong coords:', testActivity1.latitude, testActivity1.longitude);
  }
  
  // Scenario 2: Name-based matching
  const testActivity2 = {
    id: "act-nyc-1", 
    name: "Empire State Building & Top of the Rock Tour",
    provider: "Empire State Building & Top of the Rock Tour",
    latitude: 40.7500, // AI modified coordinate
    longitude: -73.9800 // AI modified coordinate
  };
  
  console.log('\nTesting scenario 2 - Name-based match:');
  console.log('AI Data:', testActivity2);
  
  const matchedActivity = activities.find(a => a.name.toLowerCase() === testActivity2.name.toLowerCase());
  if (matchedActivity) {
    console.log('✅ Match found!');
    console.log('Authentic coords:', matchedActivity.latitude, matchedActivity.longitude);
    console.log('AI had wrong coords:', testActivity2.latitude, testActivity2.longitude);
  }
}

testPartnerMatching().catch(console.error);