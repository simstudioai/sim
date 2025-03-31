// twilio-sms-test.js
// Simple standalone script to test Twilio SMS sending
// For Node.js 18+, you can use the built-in fetch instead

async function sendTwilioSMS() {
  // Configure these variables with your Twilio credentials
  const accountSid = process.env.TWILIO_ACCOUNT_SID; 
  const authToken = process.env.TWILIO_AUTH_TOKEN;   
  const fromNumber = process.env.TWILIO_FROM_NUMBER; 
  const toNumber = process.env.TWILIO_TO_NUMBER;   
  const message = 'Test message from standalone script';

  // Create Base64 auth token
  const authString = `${accountSid}:${authToken}`;
  const base64Auth = Buffer.from(authString).toString('base64');

  // Configure request
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  
  // Create form data
  const formData = new URLSearchParams();
  formData.append('To', toNumber);
  formData.append('From', fromNumber);
  formData.append('Body', message);
  
  console.log('=== TWILIO REQUEST ===');
  console.log('URL:', url);
  console.log('From:', fromNumber);
  console.log('To:', toNumber);
  console.log('Message:', message);
  console.log('Form data:', formData.toString());

  try {
    // Make the request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${base64Auth}`
      },
      body: formData.toString()
    });

    // Get the response
    const responseText = await response.text();
    const data = response.headers.get('content-type')?.includes('application/json') 
      ? JSON.parse(responseText) 
      : responseText;

    console.log('=== TWILIO RESPONSE ===');
    console.log('Status:', response.status);
    console.log('Response:', data);
    
    if (response.ok) {
      console.log('SMS sent successfully!');
      console.log('Message SID:', data.sid);
      console.log('Status:', data.status);
    } else {
      console.error('Failed to send SMS');
      console.error('Error:', data.message || responseText);
    }
  } catch (error) {
    console.error('Error sending SMS:', error);
  }
}

// Run the function
sendTwilioSMS()
  .then(() => console.log('Script completed'))
  .catch(err => console.error('Script failed:', err));
