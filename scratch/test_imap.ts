import { Config } from '../src/config/environment';
import imaps from 'imap-simple';
const { simpleParser } = require('mailparser');

async function getLatestEmail() {
  const imapConfig: any = {
    imap: {
      user: Config.email.senderEmail,
      password: Config.email.senderAppPassword,
      host: Config.email.imapHost,
      port: Config.email.imapPort,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    },
  };

  const connection = await imaps.connect(imapConfig);
  await connection.openBox('INBOX');

  const messages = await connection.search(['ALL'], { bodies: ['HEADER', 'TEXT', ''], markSeen: false });
  console.log(`Total messages in INBOX: ${messages.length}`);

  // Find latest from riverstream.qa
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];
    const allPart = item.parts.find((p: any) => p.which === '');
    if (allPart && allPart.body) {
      const parsed: any = await simpleParser(allPart.body);
      const from = parsed.from?.text || '';
      if (from.includes('riverstream.qa') || from.includes('riverstonetech')) {
        console.log('=== LATEST RIVERSTREAM QA REPLY EMAIL ===');
        console.log('Date:', parsed.date);
        console.log('Subject:', parsed.subject);
        console.log('From:', parsed.from?.text);
        console.log('--- FULL PLAIN TEXT ---\n', parsed.text);
        console.log('--- FULL HTML ---\n', parsed.html);
        break;
      }
    }
  }

  connection.end();
}

getLatestEmail().catch(console.error);
