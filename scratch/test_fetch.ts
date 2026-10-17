import { MailService } from '../src/utils/mail.service';

async function testFetch() {
  const mailService = new MailService();
  console.log('Fetching latest RiverStream reply...');
  const t0 = Date.now();
  const reply = await mailService.getLatestRiverstreamReply('Processing Summary');
  console.log(`Fetched in ${Date.now() - t0}ms`);
  console.log('Subject:', reply.subject);
  console.log('Fields:', reply.fields);

  console.log('Fetching No Attachment Found reply...');
  const t1 = Date.now();
  const noAtt = await mailService.getLatestRiverstreamReply('No Attachment Found');
  console.log(`Fetched in ${Date.now() - t1}ms`);
  console.log('No Att Subject:', noAtt.subject);
}

testFetch().catch(console.error);
