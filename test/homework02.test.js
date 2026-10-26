import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const ONE_DAY = 24 * 60 * 60;
const DURATION_DAYS = 7n;
const MIN_DONATION = ethers.parseEther("0.001");

async function deployFixture() {
  const [owner, alice, bob, carol, dave, stranger] = await ethers.getSigners();
  const begging = await ethers.deployContract("BeggingContract", [DURATION_DAYS]);
  await begging.waitForDeployment();
  return { owner, alice, bob, carol, dave, stranger, begging };
}

describe("作业二 · BeggingContract 讨饭合约", function () {
  it("构造函数记录 owner 和 7 天截止时间", async function () {
    const { owner, begging } = await networkHelpers.loadFixture(deployFixture);
    expect(await begging.owner()).to.equal(owner.address);
    expect(await begging.MIN_DONATION()).to.equal(MIN_DONATION);

    const now = BigInt(await networkHelpers.time.latest());
    expect(await begging.deadline()).to.equal(now + DURATION_DAYS * BigInt(ONE_DAY));
  });

  it("Donate 记录每个捐赠者和总额，并发出 Donation 事件", async function () {
    const { alice, bob, begging } = await networkHelpers.loadFixture(deployFixture);
    const a = ethers.parseEther("0.01");
    const b = ethers.parseEther("0.02");

    await expect(begging.connect(alice).Donate({ value: a }))
      .to.emit(begging, "Donation");
    await begging.connect(bob).Donate({ value: b });

    expect(await begging.getDonation(alice.address)).to.equal(a);
    expect(await begging.getDonation(bob.address)).to.equal(b);
    expect(await begging.getDonation(begging.target)).to.equal(0n);
    expect(await begging.totalDonated()).to.equal(a + b);
    expect(await begging.balance()).to.equal(a + b);
    expect(await begging.donorCount()).to.equal(2n);
  });

  it("同一地址多次捐赠会累加，donorCount 不重复计算", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    await begging.connect(alice).Donate({ value: MIN_DONATION });
    await begging.connect(alice).Donate({ value: MIN_DONATION });

    expect(await begging.getDonation(alice.address)).to.equal(MIN_DONATION * 2n);
    expect(await begging.totalDonated()).to.equal(MIN_DONATION * 2n);
    expect(await begging.donorCount()).to.equal(1n);
  });

  it("直接转账（receive）也会记账", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    await alice.sendTransaction({ to: await begging.getAddress(), value: MIN_DONATION });

    expect(await begging.getDonation(alice.address)).to.equal(MIN_DONATION);
    expect(await begging.totalDonated()).to.equal(MIN_DONATION);
  });

  it("低于最小捐赠额会被拒绝（Donate 和 receive 两条路径）", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    const tooSmall = MIN_DONATION - 1n;

    await expect(begging.connect(alice).Donate({ value: tooSmall }))
      .to.be.revertedWithCustomError(begging, "DonationTooSmall")
      .withArgs(tooSmall, MIN_DONATION);

    await expect(
      alice.sendTransaction({ to: await begging.getAddress(), value: tooSmall }),
    )
      .to.be.revertedWithCustomError(begging, "DonationTooSmall");
  });

  it("刚好等于最小额可以通过", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    await begging.connect(alice).Donate({ value: MIN_DONATION });
    expect(await begging.getDonation(alice.address)).to.equal(MIN_DONATION);
  });

  it("owner 可以提取全部资金", async function () {
    const { owner, alice, begging } = await networkHelpers.loadFixture(deployFixture);
    const amount = ethers.parseEther("0.03");
    await begging.connect(alice).Donate({ value: amount });

    await expect(begging.withdraw()).to.changeEtherBalance(ethers, owner.address, amount);

    expect(await begging.balance()).to.equal(0n);
    // 历史捐赠记录保留
    expect(await begging.totalDonated()).to.equal(amount);
    expect(await begging.getDonation(alice.address)).to.equal(amount);
  });

  it("非 owner 不能提取", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    await begging.connect(alice).Donate({ value: MIN_DONATION });
    await expect(begging.connect(alice).withdraw()).to.be.revertedWithCustomError(
      begging,
      "NotOwner",
    );
  });

  it("没有余额时提取会回滚", async function () {
    const { begging } = await networkHelpers.loadFixture(deployFixture);
    await expect(begging.withdraw()).to.be.revertedWithCustomError(
      begging,
      "NothingToWithdraw",
    );
  });

  it("截止后 Donate 和直接转账都会失败，timeLeft 归零", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    await networkHelpers.time.increase(7 * ONE_DAY + 1);

    await expect(begging.connect(alice).Donate({ value: MIN_DONATION }))
      .to.be.revertedWithCustomError(begging, "DonationClosed");
    await expect(
      alice.sendTransaction({ to: await begging.getAddress(), value: MIN_DONATION }),
    )
      .to.be.revertedWithCustomError(begging, "DonationClosed");

    expect(await begging.timeLeft()).to.equal(0n);
  });

  it("截止前 timeLeft 为正", async function () {
    const { begging } = await networkHelpers.loadFixture(deployFixture);
    expect(await begging.timeLeft()).to.be.greaterThan(0n);
    await networkHelpers.time.increase(ONE_DAY);
    expect(await begging.timeLeft()).to.be.greaterThan(0n);
  });

  it("top3 按金额降序返回前三名", async function () {
    const { alice, bob, carol, dave, begging } =
      await networkHelpers.loadFixture(deployFixture);
    const amounts = {
      alice: ethers.parseEther("0.01"),
      bob: ethers.parseEther("0.05"),
      carol: ethers.parseEther("0.03"),
      dave: ethers.parseEther("0.04"),
    };
    await begging.connect(alice).Donate({ value: amounts.alice });
    await begging.connect(bob).Donate({ value: amounts.bob });
    await begging.connect(carol).Donate({ value: amounts.carol });
    await begging.connect(dave).Donate({ value: amounts.dave });

    const [addrs, topAmounts] = await begging.top3();

    expect(Array.from(addrs)).to.deep.equal([
      bob.address,
      dave.address,
      carol.address,
    ]);
    expect(Array.from(topAmounts)).to.deep.equal([
      amounts.bob,
      amounts.dave,
      amounts.carol,
    ]);
  });

  it("不足三人时其余位置为零", async function () {
    const { alice, begging } = await networkHelpers.loadFixture(deployFixture);
    await begging.connect(alice).Donate({ value: MIN_DONATION });

    const [addrs, amounts] = await begging.top3();

    expect(addrs[0]).to.equal(alice.address);
    expect(amounts[0]).to.equal(MIN_DONATION);
    expect(addrs[1]).to.equal(ethers.ZeroAddress);
    expect(amounts[1]).to.equal(0n);
    expect(addrs[2]).to.equal(ethers.ZeroAddress);
    expect(amounts[2]).to.equal(0n);
  });
});
