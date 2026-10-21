/** Exact choice constraints reviewed against the two SHA-pinned original applications.
 * Each set concerns one subject/contract. Other multi-select benefit and disability choices stay independent.
 * Original SHA: rule-3211495 05a5fb88ab3199783d66d5fc77af32f425c07ba34552203d9ca4a2546e3bc1be
 * Original SHA: rule-3211501 f922a89ff89c09bfb6325d493d03104bdc23c123fc1c4b469bfc77bb1597bde1
 */
export const WRITING_EXCLUSIONS: Record<string, string[][]> = {
  "rule-3211495": [
    [
      "sp.legal",
      "sp.de-facto",
      "sp.separated"
    ],
    [
      "b.housing.own",
      "b.housing.rent",
      "b.housing.etc"
    ],
    [
      "b.childcare.home",
      "b.childcare.disabled",
      "b.childcare.rural"
    ],
    [
      "b.pc.apply",
      "b.pc.none"
    ],
    [
      "b.isp.kt",
      "b.isp.skb",
      "b.isp.lg",
      "b.isp.skt",
      "b.isp.etc"
    ],
    [
      "d.carrier.kt",
      "d.carrier.skt",
      "d.carrier.lg"
    ],
    [
      "d.phoneCo.kt",
      "d.phoneCo.skb",
      "d.phoneCo.lg"
    ],
    [
      "disc0.carrier0",
      "disc0.carrier1",
      "disc0.carrier2"
    ],
    [
      "disc1.carrier0",
      "disc1.carrier1",
      "disc1.carrier2"
    ],
    [
      "disc2.carrier0",
      "disc2.carrier1",
      "disc2.carrier2"
    ]
  ],
  "rule-3211501": [
    [
      "hc.req1",
      "hc.req2",
      "hc.req3",
      "hc.req4",
      "hc.req5",
      "hc.req6",
      "hc.req7",
      "hc.req8"
    ],
    [
      "dl.req1",
      "dl.req2",
      "dl.req3"
    ],
    [
      "ct.r1",
      "ct.r2",
      "ct.r3",
      "ct.r4",
      "ct.r5",
      "ct.r6",
      "ct.r7",
      "ct.r8",
      "ct.r9",
      "ct.r10"
    ],
    [
      "sp.legal",
      "sp.de-facto",
      "sp.separated"
    ],
    [
      "hc.h24",
      "hc.h27",
      "hc.h40"
    ],
    [
      "rh.d1",
      "rh.d2",
      "rh.d3"
    ],
    [
      "pc.rel1",
      "pc.rel2",
      "pc.rel3"
    ],
    [
      "pc.d1",
      "pc.d2"
    ],
    [
      "da.d1",
      "da.d2"
    ],
    [
      "da.day.basic",
      "da.day.extend"
    ],
    [
      "ac.new",
      "ac.change",
      "ac.renew",
      "ac.transfer"
    ],
    [
      "fm.first",
      "fm.second"
    ],
    [
      "fm.pay1",
      "fm.pay2",
      "fm.pay3"
    ],
    [
      "fm.card1",
      "fm.card2",
      "fm.card3",
      "fm.card4",
      "fm.card5",
      "fm.card6"
    ],
    [
      "ct.g1",
      "ct.g2"
    ],
    [
      "pp.t1",
      "pp.t2",
      "pp.t3",
      "pp.t4"
    ],
    [
      "pp.t1a",
      "pp.t1b",
      "pp.t1c"
    ],
    [
      "pp.t2a",
      "pp.t2b"
    ],
    [
      "pp.t3a",
      "pp.t3b"
    ],
    [
      "pp.t4a",
      "pp.t4b"
    ],
    [
      "pp.p1",
      "pp.p2"
    ]
  ]
};

const REQUIRES_ANY: Record<string, Record<string,string[]>> = {
  "rule-3211495": {
    "b.housing.own": [
      "b.housing"
    ],
    "b.housing.rent": [
      "b.housing"
    ],
    "b.housing.etc": [
      "b.housing"
    ],
    "b.childcare.home": [
      "b.childcare"
    ],
    "b.childcare.disabled": [
      "b.childcare"
    ],
    "b.childcare.rural": [
      "b.childcare"
    ],
    "b.pension.spouse": [
      "b.pension"
    ],
    "b.dPension.spouse": [
      "b.dPension"
    ],
    "b.dPension.extra": [
      "b.dPension"
    ],
    "b.youthSupport.ext": [
      "b.youthSupport"
    ],
    "b.parentCash.name": [
      "b.parentCash"
    ],
    "b.childcare.name": [
      "b.childcare"
    ],
    "b.sitterFull.name": [
      "b.sitterFull"
    ],
    "b.sitterPart.name": [
      "b.sitterPart"
    ],
    "b.childAllowance.1": [
      "b.childAllowance"
    ],
    "b.childAllowance.2": [
      "b.childAllowance"
    ],
    "b.childAllowance.3": [
      "b.childAllowance"
    ],
    "b.otherMedical.text": [
      "b.otherMedical"
    ],
    "nt.otherText": [
      "nt.other"
    ],
    "b.pc.apply": [
      "b.schoolCost"
    ],
    "b.pc.none": [
      "b.schoolCost"
    ],
    "b.pc.consent": [
      "b.schoolCost"
    ],
    "b.isp.kt": [
      "b.schoolCost"
    ],
    "b.isp.skb": [
      "b.schoolCost"
    ],
    "b.isp.lg": [
      "b.schoolCost"
    ],
    "b.isp.skt": [
      "b.schoolCost"
    ],
    "b.isp.etc": [
      "b.schoolCost"
    ],
    "b.isp.etcName": [
      "b.isp.etc"
    ],
    "b.isp.name": [
      "b.isp.kt",
      "b.isp.skb",
      "b.isp.lg",
      "b.isp.skt",
      "b.isp.etc"
    ],
    "b.isp.rrn1": [
      "b.isp.kt",
      "b.isp.skb",
      "b.isp.lg",
      "b.isp.skt",
      "b.isp.etc"
    ],
    "b.isp.rrn2": [
      "b.isp.kt",
      "b.isp.skb",
      "b.isp.lg",
      "b.isp.skt",
      "b.isp.etc"
    ],
    "d.powerNo": [
      "d.power",
      "d.all"
    ],
    "d.heatNo": [
      "d.heating",
      "d.all"
    ],
    "d.gasUser": [
      "d.gas",
      "d.all"
    ],
    "d.gasCompany": [
      "d.gas",
      "d.all"
    ],
    "d.gasNo": [
      "d.gas",
      "d.all"
    ],
    "d.phoneRrn": [
      "d.phone",
      "d.all"
    ],
    "d.phoneNo": [
      "d.phone",
      "d.all"
    ],
    "d.carrier.kt": [
      "d.mobile",
      "d.all"
    ],
    "d.carrier.skt": [
      "d.mobile",
      "d.all"
    ],
    "d.carrier.lg": [
      "d.mobile",
      "d.all"
    ],
    "d.phoneCo.kt": [
      "d.phone",
      "d.all"
    ],
    "d.phoneCo.skb": [
      "d.phone",
      "d.all"
    ],
    "d.phoneCo.lg": [
      "d.phone",
      "d.all"
    ],
    "d.basic.living": [
      "d.basic"
    ],
    "d.basic.medical": [
      "d.basic"
    ],
    "d.basic.housing": [
      "d.basic"
    ],
    "d.basic.education": [
      "d.basic"
    ]
  },
  "rule-3211501": {
    "ac.urgent": [
      "ac.new"
    ],
    "ac.c1": [
      "ac.change"
    ],
    "ac.c2": [
      "ac.change"
    ],
    "ac.c3": [
      "ac.change"
    ],
    "ac.c4": [
      "ac.change"
    ],
    "ac.c5": [
      "ac.change"
    ],
    "ac.c6": [
      "ac.change"
    ],
    "ac.c7": [
      "ac.change"
    ],
    "ac.c8": [
      "ac.change"
    ],
    "ac.c9": [
      "ac.change"
    ],
    "ac.c10": [
      "ac.change"
    ],
    "ac.s4": [
      "ac.s3"
    ],
    "ac.s5": [
      "ac.s3"
    ],
    "ac.s6": [
      "ac.s3"
    ],
    "ac.s7": [
      "ac.s3"
    ],
    "ac.s8": [
      "ac.s3"
    ],
    "da.day.basic": [
      "da.day"
    ],
    "da.day.extend": [
      "da.day"
    ],
    "hc.h40": [
      "hc.req8"
    ],
    "hc.h24": [
      "hc.req1",
      "hc.req2",
      "hc.req3",
      "hc.req4",
      "hc.req5",
      "hc.req6",
      "hc.req7"
    ],
    "hc.h27": [
      "hc.req1",
      "hc.req2",
      "hc.req3",
      "hc.req4",
      "hc.req5",
      "hc.req6",
      "hc.req7"
    ],
    "pp.t1a": [
      "pp.t1"
    ],
    "pp.t1b": [
      "pp.t1"
    ],
    "pp.t1c": [
      "pp.t1"
    ],
    "pp.t2a": [
      "pp.t2"
    ],
    "pp.t2b": [
      "pp.t2"
    ],
    "pp.t3a": [
      "pp.t3"
    ],
    "pp.t3b": [
      "pp.t3"
    ],
    "pp.t4a": [
      "pp.t4"
    ],
    "pp.t4b": [
      "pp.t4"
    ],
    "dl.basicName": [
      "dl.basic"
    ],
    "dl.specialName1": [
      "dl.special"
    ],
    "dl.specialName2": [
      "dl.special"
    ],
    "fm.bcBank": [
      "fm.card1"
    ],
    "fm.kbBank": [
      "fm.card4"
    ],
    "rh.needEtc": [
      "rh.n11"
    ],
    "lg.needEtc": [
      "lg.n3"
    ],
    "pc.relEtc": [
      "pc.rel3"
    ],
    "cc0.basic.disabled": [
      "cc0.basic"
    ],
    "cc0.basic.multi": [
      "cc0.basic"
    ],
    "cc0.age35.disabled": [
      "cc0.age35"
    ],
    "cc0.age35.multi": [
      "cc0.age35"
    ],
    "cc0.kinder.private": [
      "cc0.kinder"
    ],
    "cc1.basic.disabled": [
      "cc1.basic"
    ],
    "cc1.basic.multi": [
      "cc1.basic"
    ],
    "cc1.age35.disabled": [
      "cc1.age35"
    ],
    "cc1.age35.multi": [
      "cc1.age35"
    ],
    "cc1.kinder.private": [
      "cc1.kinder"
    ],
    "cc2.basic.disabled": [
      "cc2.basic"
    ],
    "cc2.basic.multi": [
      "cc2.basic"
    ],
    "cc2.age35.disabled": [
      "cc2.age35"
    ],
    "cc2.age35.multi": [
      "cc2.age35"
    ],
    "cc2.kinder.private": [
      "cc2.kinder"
    ],
    "dp.b2": [
      "dp.b1"
    ],
    "dp.b3": [
      "dp.b1"
    ],
    "dp.b4": [
      "dp.b1"
    ],
    "dp.b5": [
      "dp.b1"
    ],
    "dp.b7": [
      "dp.b6"
    ],
    "dp.b8": [
      "dp.b6"
    ],
    "dp.b9": [
      "dp.b6"
    ],
    "dp.x2": [
      "dp.x1"
    ],
    "dp.x3": [
      "dp.x1"
    ],
    "dp.x4": [
      "dp.x1"
    ],
    "dp.x5": [
      "dp.x1"
    ],
    "dp.x7": [
      "dp.x6"
    ],
    "dp.x8": [
      "dp.x6"
    ],
    "dp.x9": [
      "dp.x6"
    ]
  }
};

/** A subordinate field is available only while its actual source choice is selected. */
export function entryEnabled(formId:string,key:string,checks:Record<string,boolean>):boolean {
 const parents=REQUIRES_ANY[formId]?.[key];
 return !parents || parents.some(parent=>checks[parent]===true && entryEnabled(formId,parent,checks));
}
