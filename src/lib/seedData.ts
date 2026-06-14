import { encrypt } from './crypto';
import { safeDivide } from './metrics';

// Types helper for Prisma inside seed
interface PrismaClient {
  user: any;
  metaConnection: any;
  adAccount: any;
  campaign: any;
  adSet: any;
  ad: any;
  creative: any;
  insightsDaily: any;
  contentMapping: any;
  kpiTarget: any;
  crmLead: any;
  recommendation: any;
  syncJob: any;
  auditLog: any;
}

export async function seedDatabase(prisma: any) {
  // 1. Clean existing database
  await prisma.auditLog.deleteMany({});
  await prisma.recommendation.deleteMany({});
  await prisma.crmLead.deleteMany({});
  await prisma.kpiTarget.deleteMany({});
  await prisma.contentMapping.deleteMany({});
  await prisma.insightsDaily.deleteMany({});
  await prisma.creative.deleteMany({});
  await prisma.ad.deleteMany({});
  await prisma.adSet.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.adAccount.deleteMany({});
  await prisma.syncJob.deleteMany({});
  await prisma.metaConnection.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('Database cleaned. Starting seed...');

  // 2. Create Users
  const adminUser = await prisma.user.create({
    data: {
      name: 'Admin Marketing',
      email: 'admin@adscommand.com',
      passwordHash: 'admin123', // Simplified plain hash for MVP demo
      role: 'admin',
    }
  });

  const managerUser = await prisma.user.create({
    data: {
      name: 'Marketing Director',
      email: 'manager@adscommand.com',
      passwordHash: 'manager123',
      role: 'manager',
    }
  });

  const specialistUser = await prisma.user.create({
    data: {
      name: 'Ads Specialist',
      email: 'ads@adscommand.com',
      passwordHash: 'ads123',
      role: 'ads_specialist',
    }
  });

  const contentUser = await prisma.user.create({
    data: {
      name: 'Content Lead',
      email: 'content@adscommand.com',
      passwordHash: 'content123',
      role: 'content',
    }
  });

  // 3. Create Connection
  const encryptedToken = encrypt('EAABwXyzFakeTokenForDemoPurpose123456');
  const connection = await prisma.metaConnection.create({
    data: {
      userId: adminUser.id,
      connectionName: 'Dewey Main Ads Account',
      graphApiVersion: 'v25.0',
      encryptedAccessToken: encryptedToken,
      status: 'connected',
      syncStartDate: new Date('2026-05-15'),
      syncFrequency: 'Daily',
      lastTestedAt: new Date(),
      lastSyncAt: new Date(),
    }
  });

  // 4. Create Ad Account
  const adAccount = await prisma.adAccount.create({
    data: {
      metaConnectionId: connection.id,
      accountId: 'act_2938472948',
      accountName: 'Dewey School Global Campaigns',
      currency: 'VND',
      timezoneName: 'Asia/Ho_Chi_Minh',
      status: 'ACTIVE',
    }
  });

  // Naming convention: [Campus]_[Grade]_[Funnel]_[Angle]_[Format]_[Offer]_[ContentID]
  const campaignsData = [
    {
      campaignId: 'c_101',
      campaignName: 'CG_G6_MOFU_IBOBJECTION_VIDEO_NA_C012',
      objective: 'LEADS',
      dailyBudget: 500000,
      campus: 'CG', grade: 'G6', funnel: 'MOFU', angle: 'IBOBJECTION', format: 'VIDEO', offer: 'NA', contentId: 'C012'
    },
    {
      campaignId: 'c_102',
      campaignName: 'THT_G1_TOFU_TRANSITION_IMAGE_20OFF_C034',
      objective: 'OUTCOMES',
      dailyBudget: 800000,
      campus: 'THT', grade: 'G1', funnel: 'TOFU', angle: 'TRANSITION', format: 'IMAGE', offer: '20OFF', contentId: 'C034'
    },
    {
      campaignId: 'c_103',
      campaignName: 'HP_G10_BOFU_SCHOLARSHIP_CAROUSEL_TOUR_C087',
      objective: 'LEADS',
      dailyBudget: 1200000,
      campus: 'HP', grade: 'G10', funnel: 'BOFU', angle: 'SCHOLARSHIP', format: 'CAROUSEL', offer: 'TOUR', contentId: 'C087'
    },
    {
      campaignId: 'c_104',
      campaignName: 'CG_G1_TOFU_FACILITIES_VIDEO_NA_C015',
      objective: 'LEADS',
      dailyBudget: 600000,
      campus: 'CG', grade: 'G1', funnel: 'TOFU', angle: 'FACILITIES', format: 'VIDEO', offer: 'NA', contentId: 'C015'
    },
    {
      campaignId: 'c_105',
      campaignName: 'THT_G6_BOFU_CURRICULUM_IMAGE_SCHOLARSHIP_C022',
      objective: 'OUTCOMES',
      dailyBudget: 400000,
      campus: 'THT', grade: 'G6', funnel: 'BOFU', angle: 'CURRICULUM', format: 'IMAGE', offer: 'SCHOLARSHIP', contentId: 'C022'
    }
  ];

  const now = new Date();
  const createdCampaigns = [];

  for (const cData of campaignsData) {
    const campaign = await prisma.campaign.create({
      data: {
        adAccountId: adAccount.id,
        campaignId: cData.campaignId,
        campaignName: cData.campaignName,
        objective: cData.objective,
        buyingType: 'AUCTION',
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        dailyBudget: cData.dailyBudget,
        startTime: new Date('2026-05-15T00:00:00Z'),
        createdTime: new Date('2026-05-15T00:00:00Z'),
        updatedTime: new Date(),
      }
    });
    createdCampaigns.push({ ...campaign, meta: cData });
  }

  // 5. Create AdSets and Ads
  const adsetsList = [];
  const adsList = [];
  const creativesList = [];

  for (const c of createdCampaigns) {
    // 1 AdSet per campaign
    const adset = await prisma.adSet.create({
      data: {
        adAccountId: adAccount.id,
        campaignId: c.id,
        adsetId: `as_${c.campaignId.split('_')[1]}`,
        adsetName: `AS - ${c.meta.campus} - ${c.meta.grade} - ${c.meta.angle}`,
        optimizationGoal: 'LEADS',
        billingEvent: 'IMPRESSIONS',
        dailyBudget: c.dailyBudget,
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
      }
    });
    adsetsList.push(adset);

    // 1 Creative per Ad
    const creative = await prisma.creative.create({
      data: {
        adAccountId: adAccount.id,
        creativeId: `cr_${c.campaignId.split('_')[1]}`,
        name: `Creative for ${c.meta.contentId}`,
        title: `Tuyển sinh quốc tế ${c.meta.grade} tại campus ${c.meta.campus}`,
        body: `Chương trình tiêu chuẩn quốc tế giúp học sinh phát triển toàn diện. Đăng ký tham quan ngay để nhận ưu đãi ${c.meta.offer !== 'NA' ? c.meta.offer : 'đặc biệt'}!`,
        imageUrl: c.meta.format === 'VIDEO' ? 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?w=400' : 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=400',
        thumbnailUrl: 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=100',
        callToActionType: 'LEARN_MORE',
        linkUrl: 'https://dewey.edu.vn/admissions',
      }
    });
    creativesList.push(creative);

    // 1 Ad per AdSet
    const ad = await prisma.ad.create({
      data: {
        adAccountId: adAccount.id,
        campaignId: c.id,
        adsetId: adset.id,
        adId: `ad_${c.campaignId.split('_')[1]}`,
        adName: c.campaignName, // Matches naming convention
        creativeId: creative.creativeId,
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
      }
    });
    adsList.push({ ...ad, meta: c.meta });
  }

  // 6. Create Content Mappings (Auto-parsed from Naming Conventions)
  for (const ad of adsList) {
    await prisma.contentMapping.create({
      data: {
        adId: ad.id,
        contentId: ad.meta.contentId,
        campus: ad.meta.campus,
        grade: ad.meta.grade,
        funnelStage: ad.meta.funnel,
        campaignTheme: 'Tuyển sinh 2026-2027',
        angle: ad.meta.angle,
        insight: 'Phụ huynh lo lắng về khả năng hòa nhập và chi phí học tập.',
        hookType: ad.meta.angle === 'IBOBJECTION' ? 'QUESTION' : 'STORY',
        format: ad.meta.format,
        offer: ad.meta.offer,
        creator: 'Content Team A',
        contentStatus: ad.meta.contentId === 'C012' ? 'win' : ad.meta.contentId === 'C034' ? 'scale' : 'testing',
        note: 'Bài viết đang chạy thử nghiệm, phản hồi tốt.',
      }
    });
  }

  // 7. Create KPIs for Month 6, Year 2026
  const currentMonth = 6;
  const currentYear = 2026;

  const kpis = [
    { campus: 'CG', grade: 'G6', source: 'LeadAds', leads: 80, ql: 30, wl: 10, enroll: 4, budget: 15000000 },
    { campus: 'CG', grade: 'G1', source: 'LeadAds', leads: 100, ql: 40, wl: 12, enroll: 5, budget: 20000000 },
    { campus: 'THT', grade: 'G1', source: 'Conversion', leads: 120, ql: 45, wl: 15, enroll: 6, budget: 25000000 },
    { campus: 'THT', grade: 'G6', source: 'Messenger', leads: 60, ql: 20, wl: 5, enroll: 2, budget: 12000000 },
    { campus: 'HP', grade: 'G10', source: 'LeadAds', leads: 150, ql: 50, wl: 18, enroll: 8, budget: 35000000 }
  ];

  for (const k of kpis) {
    await prisma.kpiTarget.create({
      data: {
        month: currentMonth,
        year: currentYear,
        campus: k.campus,
        grade: k.grade,
        source: k.source,
        targetLeads: k.leads,
        targetQualifiedLeads: k.ql,
        targetWl: k.wl,
        targetEnrollments: k.enroll,
        monthlyBudget: k.budget,
      }
    });
  }

  // 8. Generate Daily Insights and CRM Leads for 30 Days
  const dateCursor = new Date(now);
  dateCursor.setDate(dateCursor.getDate() - 30);

  const insightsRecords = [];
  const crmLeadsRecords = [];

  // Random generator helpers
  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomFloat = (min: number, max: number) => Math.random() * (max - min) + min;

  for (let i = 0; i < 30; i++) {
    const currentDate = new Date(dateCursor);
    currentDate.setHours(12, 0, 0, 0);

    for (const ad of adsList) {
      // Simulate performance based on campaign quality
      let performanceFactor = 1.0;
      if (ad.meta.contentId === 'C012') performanceFactor = 1.5; // Win: more leads, cheaper CPL
      if (ad.meta.contentId === 'C087') performanceFactor = 0.8; // Fatigue or poor performance
      
      const impressions = randomInt(5000, 15000);
      const reach = Math.round(impressions * randomFloat(0.6, 0.8));
      
      // CTR: Win content (C012) has high CTR, tired content (C087) has lower CTR
      const ctr = ad.meta.contentId === 'C012' ? randomFloat(1.8, 2.5) : ad.meta.contentId === 'C087' ? randomFloat(0.6, 0.9) : randomFloat(1.0, 1.6);
      const clicks = Math.round(impressions * (ctr / 100));
      const linkClicks = Math.round(clicks * randomFloat(0.7, 0.9));
      
      const spend = ad.meta.contentId === 'C012' ? randomInt(400000, 600000) : randomInt(300000, 500000);
      
      // Leads: conversion rates
      const leadConvRate = ad.meta.contentId === 'C012' ? 0.05 : ad.meta.contentId === 'C087' ? 0.01 : 0.03;
      const leads = Math.round(linkClicks * leadConvRate * performanceFactor);
      
      // Metrics
      const cpc = safeDivide(spend, clicks) || 0;
      const cpm = (safeDivide(spend, impressions) || 0) * 1000;
      const cpl = leads > 0 ? spend / leads : 0;
      const frequency = impressions / reach;

      // Create insights for AD level
      await prisma.insightsDaily.create({
        data: {
          date: currentDate,
          adAccountId: adAccount.id,
          campaignId: ad.campaignId,
          campaignName: ad.adName,
          adsetId: ad.adsetId,
          adsetName: `AS - ${ad.meta.campus} - ${ad.meta.grade} - ${ad.meta.angle}`,
          adId: ad.adId,
          adName: ad.adName,
          level: 'ad',
          spend,
          impressions,
          reach,
          frequency,
          clicks,
          linkClicks,
          uniqueClicks: clicks,
          inlineLinkClicks: linkClicks,
          ctr,
          uniqueCtr: ctr,
          cpc,
          cpm,
          cpp: cpm * 1.2,
          leads,
          costPerLead: cpl,
          landingPageViews: Math.round(linkClicks * 0.8),
          costPerLandingPageView: safeDivide(spend, Math.round(linkClicks * 0.8)) || 0,
          video3sViews: ad.meta.format === 'VIDEO' ? randomInt(3000, 8000) : 0,
          videoThruplay: ad.meta.format === 'VIDEO' ? randomInt(1000, 3000) : 0,
          actionsJson: JSON.stringify([{ action_type: 'lead', value: leads }]),
          costPerActionTypeJson: JSON.stringify([{ action_type: 'lead', value: cpl }]),
        }
      });

      // Create insights for CAMPAIGN level
      await prisma.insightsDaily.create({
        data: {
          date: currentDate,
          adAccountId: adAccount.id,
          campaignId: ad.campaignId,
          campaignName: ad.adName,
          adsetId: ad.adsetId,
          adsetName: `AS - ${ad.meta.campus} - ${ad.meta.grade} - ${ad.meta.angle}`,
          adId: ad.adId, // For campaign level, we map same ID or generic
          adName: ad.adName,
          level: 'campaign',
          spend,
          impressions,
          reach,
          frequency,
          clicks,
          linkClicks,
          uniqueClicks: clicks,
          inlineLinkClicks: linkClicks,
          ctr,
          uniqueCtr: ctr,
          cpc,
          cpm,
          cpp: cpm * 1.2,
          leads,
          costPerLead: cpl,
          landingPageViews: Math.round(linkClicks * 0.8),
          costPerLandingPageView: safeDivide(spend, Math.round(linkClicks * 0.8)) || 0,
          video3sViews: ad.meta.format === 'VIDEO' ? randomInt(3000, 8000) : 0,
          videoThruplay: ad.meta.format === 'VIDEO' ? randomInt(1000, 3000) : 0,
        }
      });

      // Simulate CRM Leads mapping to ads
      if (leads > 0) {
        for (let l = 0; l < leads; l++) {
          // Determine status: 40% Qualified, 15% WL, 5% Enrolled
          const rand = Math.random();
          let leadStatus = 'lead';
          let rejectReason = null;
          
          if (rand > 0.6) {
            leadStatus = 'qualified_lead';
            if (rand > 0.85) {
              leadStatus = 'wl';
              if (rand > 0.95) {
                leadStatus = 'enrolled';
              }
            }
          } else {
            // Unqualified reason
            rejectReason = Math.random() > 0.5 ? 'Sai số điện thoại' : 'Không có nhu cầu / Không phù hợp độ tuổi';
            if (Math.random() > 0.8) leadStatus = 'rejected';
          }

          // Create lead
          const phoneSuffix = randomInt(1000, 9999);
          const emailPrefix = `lead_${currentDate.getTime()}_${l}`;
          
          await prisma.crmLead.create({
            data: {
              leadDate: currentDate,
              phoneHash: `098***${phoneSuffix}`, // Simulating masked phone for security
              emailHash: `${emailPrefix}@gmail.com`,
              source: ad.meta.objective === 'LEADS' ? 'LeadAds' : 'Conversion',
              campaignId: ad.campaignId,
              adsetId: ad.adsetId,
              adId: ad.adId,
              contentId: ad.meta.contentId,
              campus: ad.meta.campus,
              grade: ad.meta.grade,
              leadStatus,
              rejectReason,
              salesOwner: `Tư vấn viên ${randomInt(1, 3)}`,
            }
          });
        }
      }
    }

    dateCursor.setDate(dateCursor.getDate() + 1);
  }

  // 9. Generate recommendations programmatically
  // Scale recommendation for C012
  const adC012 = adsList.find(a => a.meta.contentId === 'C012');
  if (adC012) {
    await prisma.recommendation.create({
      data: {
        date: new Date(),
        objectType: 'ad',
        objectId: adC012.adId,
        recommendationType: 'SCALE',
        severity: 'medium',
        title: `Tăng ngân sách quảng cáo - ${adC012.adName}`,
        reason: `Mẫu quảng cáo này có CPL cực tốt chỉ 115k (thấp hơn benchmark trung bình 250k) và đã thu về hơn 25 leads. Tần suất hiển thị vẫn ở mức an toàn 1.8.`,
        evidenceJson: JSON.stringify({ spend: 5400000, leads: 47, cpl: 114890, ctr: 2.12, frequency: 1.82 }),
        status: 'pending',
        assignedTo: specialistUser.name,
      }
    });
  }

  // Cut recommendation for C087
  const adC087 = adsList.find(a => a.meta.contentId === 'C087');
  if (adC087) {
    await prisma.recommendation.create({
      data: {
        date: new Date(),
        objectType: 'ad',
        objectId: adC087.adId,
        recommendationType: 'CUT',
        severity: 'high',
        title: `Dừng quảng cáo không hiệu quả - ${adC087.adName}`,
        reason: `Mẫu quảng cáo đã tiêu hơn 2.4 triệu (vượt ngưỡng cắt 2 triệu) nhưng chỉ ra được 1 Lead duy nhất. Chi phí CPL quá đắt đỏ và tỷ lệ nhấp CTR cực thấp (0.75%).`,
        evidenceJson: JSON.stringify({ spend: 2420000, leads: 1, cpl: 2420000, ctr: 0.75, frequency: 2.54 }),
        status: 'pending',
      }
    });
  }

  // Refresh Creative recommendation
  const adC015 = adsList.find(a => a.meta.contentId === 'C015');
  if (adC015) {
    await prisma.recommendation.create({
      data: {
        date: new Date(),
        objectType: 'ad',
        objectId: adC015.adId,
        recommendationType: 'REFRESH_CREATIVE',
        severity: 'medium',
        title: `Làm mới sáng tạo (Refresh Creative) - ${adC015.adName}`,
        reason: `Tần suất hiển thị của mẫu quảng cáo này đã chạm mốc 3.52 (vượt ngưỡng mỏi 3.0), kéo theo CTR giảm mạnh 28% và chi phí CPL có xu hướng tăng 35% trong 3 ngày vừa qua.`,
        evidenceJson: JSON.stringify({ spend: 4800000, leads: 12, cpl: 400000, ctr: 0.92, frequency: 3.52, ctrTrend3Days: -28 }),
        status: 'pending',
        assignedTo: contentUser.name,
      }
    });
  }

  // Lead Quality recommendation
  const adC034 = adsList.find(a => a.meta.contentId === 'C034');
  if (adC034) {
    await prisma.recommendation.create({
      data: {
        date: new Date(),
        objectType: 'ad',
        objectId: adC034.adId,
        recommendationType: 'CHECK_LEAD_QUALITY',
        severity: 'medium',
        title: `Đánh giá chất lượng Lead quảng cáo - ${adC034.adName}`,
        reason: `Mẫu quảng cáo tạo ra lượng Lead rẻ dồi dào (32 Lead, CPL 140k) nhưng tỷ lệ chuyển đổi sang Lead Chất Lượng (QL) chỉ vỏn vẹn 9.4% (benchmark tiêu chuẩn là 30%). Tệp khách hàng thu được có dấu hiệu không đúng nhu cầu thực tế.`,
        evidenceJson: JSON.stringify({ spend: 4500000, leads: 32, cpl: 140625, ctr: 1.68, frequency: 2.15, leadToQlRate: 9.37, qualifiedLeads: 3 }),
        status: 'pending',
        assignedTo: specialistUser.name,
      }
    });
  }

  console.log('Seed database completed successfully!');
}
