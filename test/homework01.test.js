import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const asNumbers = (arr) => Array.from(arr).map((x) => Number(x));

describe("作业一 · 基础算法", function () {
  // ============================================================
  // 第 1 题：投票合约
  // ============================================================
  describe("1. Voting 投票合约", function () {
    let voting;
    let owner;
    let alice;
    let bob;

    beforeEach(async function () {
      [owner, alice, bob] = await ethers.getSigners();
      voting = await ethers.deployContract("Voting", [["Alice", "Bob"]]);
      await voting.waitForDeployment();
    });

    it("部署时写入候选人，初始票数都是 0", async function () {
      expect(await voting.candidateCount()).to.equal(2n);
      expect(Array.from(await voting.getCandidates())).to.deep.equal(["Alice", "Bob"]);
      expect(await voting.getVotes("Alice")).to.equal(0n);
      expect(await voting.getVotes("Bob")).to.equal(0n);
      expect(await voting.totalVotes()).to.equal(0n);
    });

    it("投票后票数 +1，并发出 Voted 事件", async function () {
      await expect(voting.connect(alice).vote("Alice"))
        .to.emit(voting, "Voted")
        .withArgs(alice.address, "Alice", 1n);

      expect(await voting.getVotes("Alice")).to.equal(1n);
      expect(await voting.totalVotes()).to.equal(1n);
      expect(await voting.hasVoted(alice.address)).to.equal(true);
    });

    it("同一个人不能投两次", async function () {
      await voting.connect(alice).vote("Alice");
      await expect(voting.connect(alice).vote("Bob")).to.be.revertedWith(
        "You have already voted",
      );
    });

    it("投给不存在的候选人会失败", async function () {
      await expect(voting.connect(bob).vote("Nobody")).to.be.revertedWith(
        "no such candidate",
      );
    });

    it("只有 owner 能重置票数，重置后票数清零", async function () {
      await voting.connect(alice).vote("Alice");
      await voting.connect(bob).vote("Bob");

      await expect(voting.connect(alice).resetVotes()).to.be.revertedWith(
        "Only owner can call this function",
      );

      await expect(voting.resetVotes())
        .to.emit(voting, "VoteReset")
        .withArgs(owner.address);

      expect(await voting.getVotes("Alice")).to.equal(0n);
      expect(await voting.getVotes("Bob")).to.equal(0n);
      expect(await voting.totalVotes()).to.equal(0n);
    });

    it("只有 owner 能添加候选人", async function () {
      await expect(voting.connect(alice).addCandidate("Carol")).to.be.revertedWith(
        "Only owner can call this function",
      );

      await expect(voting.addCandidate("Carol"))
        .to.emit(voting, "CandidateAdded")
        .withArgs("Carol");

      expect(await voting.candidateCount()).to.equal(3n);
    });

    it("候选人不能重名，也不能为空", async function () {
      await expect(voting.addCandidate("Alice")).to.be.revertedWith(
        "Candidate already exists",
      );
      await expect(voting.addCandidate("")).to.be.revertedWith(
        "Candidate name cannot be empty",
      );
    });
  });

  // ============================================================
  // 第 2 题：反转字符串
  // ============================================================
  describe("2. StringTool 反转字符串", function () {
    let str;

    beforeEach(async function () {
      str = await ethers.deployContract("StringTool");
      await str.waitForDeployment();
    });

    it("abcde -> edcba", async function () {
      expect(await str.reverse("abcde")).to.equal("edcba");
    });

    it("空字符串 -> 空字符串", async function () {
      expect(await str.reverse("")).to.equal("");
    });

    it("单个字符不变", async function () {
      expect(await str.reverse("a")).to.equal("a");
    });

    it("两个字符交换", async function () {
      expect(await str.reverse("ab")).to.equal("ba");
    });

    it("回文反转后不变", async function () {
      expect(await str.reverse("racecar")).to.equal("racecar");
    });

    it("长字符串", async function () {
      expect(await str.reverse("0123456789")).to.equal("9876543210");
    });
  });

  // ============================================================
  // 第 3、4 题：罗马数字互转
  // ============================================================
  describe("3/4. RomanConverter 罗马数字", function () {
    let roman;

    beforeEach(async function () {
      roman = await ethers.deployContract("RomanConverter");
      await roman.waitForDeployment();
    });

    it("整数 -> 罗马数字（覆盖全部减法组合）", async function () {
      const cases = [
        [1, "I"],
        [2, "II"],
        [3, "III"],
        [4, "IV"],
        [5, "V"],
        [9, "IX"],
        [10, "X"],
        [14, "XIV"],
        [40, "XL"],
        [49, "XLIX"],
        [58, "LVIII"],
        [90, "XC"],
        [400, "CD"],
        [900, "CM"],
        [1994, "MCMXCIV"],
        [3999, "MMMCMXCIX"],
      ];
      for (const [n, expected] of cases) {
        expect(await roman.intToRoman(n), `intToRoman(${n})`).to.equal(expected);
      }
    });

    it("罗马数字 -> 整数", async function () {
      const cases = [
        ["I", 1],
        ["IV", 4],
        ["IX", 9],
        ["LVIII", 58],
        ["MCMXCIV", 1994],
        ["MMMCMXCIX", 3999],
      ];
      for (const [r, expected] of cases) {
        expect(await roman.romanToInt(r), `romanToInt("${r}")`).to.equal(BigInt(expected));
      }
    });

    it("边界：0 和 4000 会被拒绝", async function () {
      await expect(roman.intToRoman(0)).to.be.revertedWith(
        "num must be between 1 and 3999",
      );
      await expect(roman.intToRoman(4000)).to.be.revertedWith(
        "num must be between 1 and 3999",
      );
    });

    it("空串和非法字符会被拒绝", async function () {
      await expect(roman.romanToInt("")).to.be.revertedWith("roman: empty string");
      await expect(roman.romanToInt("ABC")).to.be.revertedWith(
        "invalid roman character",
      );
    });

    it("互转自洽：1~300 全部往返一致", async function () {
      for (let i = 1; i <= 300; i++) {
        const r = await roman.intToRoman(i);
        expect(await roman.romanToInt(r), `round trip ${i} -> ${r}`).to.equal(BigInt(i));
      }
    });
  });

  // ============================================================
  // 第 5、6 题：合并数组 + 二分查找
  // ============================================================
  describe("5/6. ArrayAlgorithm", function () {
    let alg;

    beforeEach(async function () {
      alg = await ethers.deployContract("ArrayAlgorithm");
      await alg.waitForDeployment();
    });

    it("合并两个有序数组", async function () {
      const merged = await alg.merge([1, 3, 5], [2, 4, 6]);
      expect(asNumbers(merged)).to.deep.equal([1, 2, 3, 4, 5, 6]);
    });

    it("长度不一致也能合并", async function () {
      const merged = await alg.merge([1, 2], [3, 4, 5, 6]);
      expect(asNumbers(merged)).to.deep.equal([1, 2, 3, 4, 5, 6]);
    });

    it("有空数组时直接返回另一个", async function () {
      expect(asNumbers(await alg.merge([], [7, 8]))).to.deep.equal([7, 8]);
      expect(asNumbers(await alg.merge([9], []))).to.deep.equal([9]);
      expect(asNumbers(await alg.merge([], []))).to.deep.equal([]);
    });

    it("包含重复元素时仍然有序", async function () {
      const merged = await alg.merge([1, 2, 2], [2, 3]);
      expect(asNumbers(merged)).to.deep.equal([1, 2, 2, 2, 3]);
    });

    it("二分查找找到目标", async function () {
      const [found, index] = await alg.binarySearch([1, 3, 5, 7, 9], 7);
      expect(found).to.equal(true);
      expect(index).to.equal(3n);
    });

    it("二分查找找不到时返回 false", async function () {
      const [found, index] = await alg.binarySearch([1, 3, 5, 7, 9], 4);
      expect(found).to.equal(false);
      expect(index).to.equal(ethers.MaxUint256);
    });

    it("二分查找边界：第一个和最后一个", async function () {
      expect((await alg.binarySearch([1, 3, 5], 1))[1]).to.equal(0n);
      expect((await alg.binarySearch([1, 3, 5], 5))[1]).to.equal(2n);
    });

    it("空数组和单元素数组", async function () {
      expect((await alg.binarySearch([], 1))[0]).to.equal(false);
      expect((await alg.binarySearch([42], 42))[0]).to.equal(true);
      expect((await alg.binarySearch([42], 42))[1]).to.equal(0n);
      expect((await alg.binarySearch([42], 7))[0]).to.equal(false);
    });
  });
});
